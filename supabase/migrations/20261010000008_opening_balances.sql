-- Account-level opening balances, and bank / credit card accounts tied to a portfolio or property.
--
--  * Any asset or liability account can carry an opening balance, posted as an "Opening balance"
--    transaction against Opening Balance Equity.
--  * Bank and credit card accounts can be tied to a property or a portfolio, so transactions on
--    that property default to being paid from that account.

alter table accounts
  add column portfolio_id uuid,
  add column property_id uuid,
  add column last4 text check (last4 is null or last4 ~ '^[0-9]{1,4}$'),
  add foreign key (portfolio_id, workspace_id) references portfolios (id, workspace_id),
  add foreign key (property_id, workspace_id) references properties (id, workspace_id),
  add check (not (portfolio_id is not null and property_id is not null));
create index accounts_property on accounts (property_id) where property_id is not null;
create index accounts_portfolio on accounts (portfolio_id) where portfolio_id is not null;

-- Find (or create) the entity's Opening Balance Equity account.
create or replace function opening_equity_account(p_entity_id uuid) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_workspace uuid;
  v_desc constant text := 'Your starting equity: what you owned minus what you owed on the day you started using Mondayboss. It is set automatically when you enter opening balances.';
begin
  select id into v_id from accounts where entity_id = p_entity_id and subtype = 'opening_balance' limit 1;
  if found then
    return v_id;
  end if;

  select workspace_id into v_workspace from entities where id = p_entity_id;
  begin
    insert into accounts (workspace_id, entity_id, code, name, type, subtype, description)
    values (v_workspace, p_entity_id, '3050', 'Opening Balance Equity', 'equity', 'opening_balance', v_desc)
    returning id into v_id;
  exception when unique_violation then
    -- Code 3050 or the name is already taken by a custom account; fall back to a generated code.
    v_id := create_account(p_entity_id, null, 'equity', 'Opening Balance Equity (system)', null, v_desc);
    update accounts set subtype = 'opening_balance' where id = v_id;
  end;
  return v_id;
end $$;

-- Post an account's opening balance as one balanced "Opening balance" transaction.
-- p_amount_cents is in the account's normal direction: money in a bank account, or money owed on a
-- credit card or loan. A negative amount flips it (an overdraft, or a credit balance on a card).
-- The offsetting side goes to Opening Balance Equity, tagged with the same property.
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

  if exists (
    select 1
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    where l.account_id = p_account_id and e.source = 'system' and e.memo like 'Opening balance:%'
      and not exists (select 1 from journal_entries r where r.reverses_entry_id = e.id)
  ) then
    raise exception 'This account already has an opening balance. Reverse it first to enter a new one.';
  end if;

  v_debit_normal := v_acct.type = 'asset' and coalesce(v_acct.subtype, '') <> 'contra_asset';
  v_on_debit := v_debit_normal = (p_amount_cents > 0);
  v_abs := abs(p_amount_cents);
  v_prop := coalesce(p_property_id, v_acct.property_id);
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

-- Create a bank account or credit card, optionally tied to a property or portfolio and with an opening balance.
create or replace function create_cash_account(
  p_entity_id uuid,
  p_kind text,                       -- 'bank' or 'credit_card'
  p_name text,
  p_last4 text default null,
  p_property_id uuid default null,
  p_portfolio_id uuid default null,
  p_opening_cents bigint default null,
  p_as_of date default null
) returns uuid
language plpgsql
as $$
declare
  v_type account_type;
  v_desc text;
  v_id uuid;
begin
  if p_kind = 'bank' then
    v_type := 'asset';
    v_desc := 'A bank account. Money paid in and out of it is tracked here.';
  elsif p_kind = 'credit_card' then
    v_type := 'liability';
    v_desc := 'A credit card. Its balance is what you owe the card company.';
  else
    raise exception 'Unknown account kind: %', p_kind;
  end if;
  if p_property_id is not null and p_portfolio_id is not null then
    raise exception 'Tie an account to a property or a portfolio, not both';
  end if;
  if p_opening_cents is not null and p_opening_cents <> 0 and p_as_of is null then
    raise exception 'Enter the date of the opening balance';
  end if;

  v_id := create_account(p_entity_id, null, v_type, p_name, null, v_desc);
  update accounts
     set subtype = case when p_kind = 'bank' then 'cash' else 'credit_card' end,
         is_bank = (p_kind = 'bank'),
         property_id = p_property_id,
         portfolio_id = p_portfolio_id,
         last4 = nullif(trim(coalesce(p_last4, '')), '')
   where id = v_id;

  if p_opening_cents is not null and p_opening_cents <> 0 then
    perform set_account_opening_balance(v_id, p_as_of, p_opening_cents);
  end if;
  return v_id;
end $$;
