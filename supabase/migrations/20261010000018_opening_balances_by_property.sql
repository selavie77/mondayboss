-- Opening balances for a whole set of accounts at once.
--
--  * A loan, escrow or deposit account can carry a different opening balance for each property, so an
--    opening balance is unique per account AND property (it used to be one per account).
--  * opening_candidates() lists the balance sheet accounts that have activity, with how much that
--    activity has moved each balance through a date, so a statement balance can be turned into an opening one.

create or replace function set_account_opening_balance(
  p_account_id uuid,
  p_as_of date,
  p_amount_cents bigint,
  p_property_id uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_acct accounts%rowtype;
  v_debit_normal boolean;
  v_on_debit boolean;
  v_abs bigint;
  v_prop uuid;
  v_equity uuid;
begin
  select * into v_acct from accounts where id = p_account_id;
  if not found then
    raise exception 'Account not found';
  end if;
  if v_acct.type not in ('asset', 'liability') then
    raise exception 'Opening balances can only be set on asset and liability accounts';
  end if;
  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'Enter an opening balance';
  end if;
  if p_as_of is null then
    raise exception 'Enter the date of the opening balance';
  end if;

  v_prop := coalesce(p_property_id, v_acct.property_id);

  if exists (
    select 1
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    where l.account_id = p_account_id
      and l.property_id is not distinct from v_prop
      and e.source = 'system' and e.memo like 'Opening balance:%'
      and not exists (select 1 from journal_entries r where r.reverses_entry_id = e.id)
  ) then
    raise exception 'This account already has an opening balance. Reverse it first to enter a new one.';
  end if;

  v_debit_normal := v_acct.type = 'asset' and coalesce(v_acct.subtype, '') <> 'contra_asset';
  v_on_debit := v_debit_normal = (p_amount_cents > 0);
  v_abs := abs(p_amount_cents);
  v_equity := opening_equity_account(v_acct.entity_id);

  return post_entry(
    v_acct.entity_id,
    p_as_of,
    'Opening balance: ' || v_acct.name,
    jsonb_build_array(
      jsonb_build_object('account_id', p_account_id, 'property_id', v_prop,
        'debit_cents', case when v_on_debit then v_abs else 0 end,
        'credit_cents', case when v_on_debit then 0 else v_abs end),
      jsonb_build_object('account_id', v_equity, 'property_id', v_prop,
        'debit_cents', case when v_on_debit then 0 else v_abs end,
        'credit_cents', case when v_on_debit then v_abs else 0 end,
        'memo', 'Opening balance equity')
    ),
    'system'
  );
end $$;

-- Every asset or liability account and property that has activity, with that activity's effect on the balance
-- through p_through (in the account's normal direction: money in an account, or money owed). Opening balances
-- and their reversals are not activity.
create or replace function opening_candidates(p_entity_id uuid, p_through date)
returns table (account_id uuid, property_id uuid, movement_cents bigint, line_count bigint)
language sql
stable
as $$
  select l.account_id,
         l.property_id,
         coalesce(sum(case when a.type = 'asset' and coalesce(a.subtype, '') <> 'contra_asset'
                           then l.debit_cents - l.credit_cents
                           else l.credit_cents - l.debit_cents end)
                  filter (where e.entry_date <= p_through), 0)::bigint,
         count(*)
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  where l.entity_id = p_entity_id
    and a.type in ('asset', 'liability')
    and a.subtype is distinct from 'opening_balance'
    and not (e.source = 'system' and e.memo like 'Opening balance:%')
    and not (e.source = 'reversal' and e.memo like 'Reversal of Opening balance:%')
  group by l.account_id, l.property_id
$$;
