-- Selling a property.
--
--  * A property remembers when it was sold and which journal entry recorded the sale.
--  * A "Gain (Loss) on Sale of Property" account holds the result, apart from rental income.
--  * property_sale_facts() reads what a sale has to remove or clear from the books for one property.

alter table properties
  add column sold_on date,
  add column sale_entry_id uuid references journal_entries (id);

-- The entity's gain/loss account, created the first time a sale is recorded.
create or replace function ensure_sale_gain_account(p_entity_id uuid) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_workspace uuid;
  v_desc constant text := 'The profit or loss when you sell a property: what you received after selling costs, minus what the property cost you (less depreciation taken). A loss is a debit. It is reported apart from rental income.';
begin
  select id into v_id from accounts where entity_id = p_entity_id and subtype = 'sale_gain' limit 1;
  if found then
    return v_id;
  end if;

  select workspace_id into v_workspace from entities where id = p_entity_id;
  begin
    insert into accounts (workspace_id, entity_id, code, name, type, subtype, description)
    values (v_workspace, p_entity_id, '4200', 'Gain (Loss) on Sale of Property', 'income', 'sale_gain', v_desc)
    returning id into v_id;
  exception when unique_violation then
    v_id := create_account(p_entity_id, null, 'income', 'Gain (Loss) on Sale of Property (system)', null, v_desc);
    update accounts set subtype = 'sale_gain' where id = v_id;
  end;
  return v_id;
end $$;

-- What a property's books hold on a date, by the kind of account, in each account's normal direction:
--   cost       what the property cost (and improvements), per account
--   accum_depr depreciation taken so far
--   loan       what is still owed on the loan
--   escrow     escrow held by the lender
--   deposits   security deposits held for tenants
--   proceeds   net sale money already recorded in Transfers > Sale Proceeds (credit balance)
create or replace function property_sale_facts(p_property_id uuid, p_through date)
returns table (kind text, account_id uuid, cents bigint)
language sql
stable
as $$
  select k.kind, l.account_id,
         sum(case when k.debit_normal then l.debit_cents - l.credit_cents else l.credit_cents - l.debit_cents end)::bigint
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  cross join lateral (
    select case
             when a.type = 'asset' and a.subtype = 'fixed_asset' then 'cost'
             when a.type = 'asset' and a.subtype = 'contra_asset' then 'accum_depr'
             when a.type = 'asset' and a.subtype = 'escrow' then 'escrow'
             when a.type = 'liability' and a.subtype = 'loan' then 'loan'
             when a.type = 'liability' and a.subtype = 'deposits' then 'deposits'
             when a.type = 'equity' and a.name = 'Sale Proceeds' then 'proceeds'
           end as kind,
           (a.type = 'asset' and a.subtype = 'fixed_asset') or (a.type = 'asset' and a.subtype = 'escrow') as debit_normal
  ) k
  where l.property_id = p_property_id
    and e.entry_date <= p_through
    and k.kind is not null
  group by k.kind, l.account_id
  having sum(l.debit_cents) <> sum(l.credit_cents)
$$;
