-- Plain-English descriptions so people understand what each category is for.

alter table accounts add column description text check (description is null or char_length(description) <= 400);

create or replace function default_account_description(p_code text) returns text
language sql immutable as $$
  select case p_code
    when '1000' then 'The bank account your rent lands in and your property expenses are paid from.'
    when '1010' then 'Bank account holding tenants'' security deposits, kept separate from your operating money.'
    when '1100' then 'Money your lender holds from your mortgage payments to pay property taxes and insurance for you. It is your money, not an expense, until the lender pays a bill from it.'
    when '1200' then 'What you paid for the property, plus closing costs and major improvements. This is the starting point for depreciation.'
    when '1210' then 'The total depreciation you have deducted so far. It lowers the property''s value on your balance sheet.'
    when '2000' then 'Tenants'' deposits you are holding and may owe back. Not income.'
    when '2100' then 'What you still owe on your mortgages. The principal part of each payment reduces this balance; it is not an expense.'
    when '2200' then 'Balance owed on credit cards used for property expenses.'
    when '3000' then 'Money you put into the business from your own pocket, such as covering a repair.'
    when '3100' then 'Money you take out of the business for yourself. Not an expense and not deductible.'
    when '3900' then 'Profit from past years that stayed in the business. The system maintains this; you rarely touch it.'
    when '4000' then 'Rent paid by tenants. Reported on Schedule E as rents received.'
    when '4010' then 'The housing authority''s share of rent for Section 8 tenants. Reported as rental income.'
    when '4100' then 'Late fees, pet or application fees, and other charges to tenants.'
    when '5000' then 'Listing fees and marketing to find tenants.'
    when '5010' then 'Mileage and travel to and from your rentals, for property business only.'
    when '5020' then 'Routine upkeep like lawn care and cleaning between tenants that does not improve the property.'
    when '5030' then 'Fees paid to agents or managers for finding and placing a tenant.'
    when '5040' then 'Landlord, liability and hazard insurance premiums you pay directly.'
    when '5050' then 'Attorneys, evictions, accountants and tax preparers for the rental business.'
    when '5060' then 'What a property manager charges to run the property, usually a percentage of rent.'
    when '5070' then 'The interest part of your mortgage payment. Deductible; the principal part is not.'
    when '5080' then 'Interest on loans or credit cards used for the rental business, apart from the mortgage.'
    when '5090' then 'Fixing something that is broken without improving it, like a leaky faucet. Big upgrades are depreciated instead.'
    when '5100' then 'Small items for the rentals, such as light bulbs, locks and paint.'
    when '5110' then 'Real estate taxes on the property, whether you pay them directly or through escrow.'
    when '5120' then 'Gas, electric, water and sewer, trash and internet that you pay for the property.'
    when '5130' then 'Spreading the cost of the building over its useful life (27.5 years for residential rentals). A deduction with no cash spent.'
    when '5140' then 'Anything that does not fit elsewhere, such as bank charges and small licenses.'
  end
$$;

-- Backfill existing default accounts that have no description yet.
update accounts set description = default_account_description(code)
where description is null and parent_id is null;

-- Recreate the helpers with a description parameter.
drop function create_account(uuid, uuid, account_type, text, text);
drop function ensure_subaccount(uuid, text);

create or replace function create_account(
  p_entity_id uuid,
  p_parent_id uuid,
  p_type account_type,
  p_name text,
  p_tax_line text default null,
  p_description text default null
) returns uuid
language plpgsql
as $$
declare
  v_workspace uuid;
  v_parent accounts%rowtype;
  v_code text;
  v_base integer;
  v_next integer;
  v_n integer;
  v_id uuid;
  v_name text := trim(p_name);
  v_desc text := nullif(trim(coalesce(p_description, '')), '');
begin
  if v_name = '' then
    raise exception 'A name is required' using errcode = '23514';
  end if;

  select workspace_id into v_workspace from entities where id = p_entity_id;
  if v_workspace is null then
    raise exception 'Entity % not found', p_entity_id;
  end if;

  if p_parent_id is not null then
    select * into v_parent from accounts where id = p_parent_id and entity_id = p_entity_id;
    if not found then
      raise exception 'Parent category not found';
    end if;
    v_n := (select count(*) from accounts where parent_id = p_parent_id) + 1;
    loop
      v_code := v_parent.code || '.' || lpad(v_n::text, 2, '0');
      exit when not exists (select 1 from accounts where entity_id = p_entity_id and code = v_code);
      v_n := v_n + 1;
    end loop;
    insert into accounts (workspace_id, entity_id, code, name, type, subtype, tax_line, parent_id, description)
    values (v_workspace, p_entity_id, v_code, v_name, v_parent.type, v_parent.subtype, null, p_parent_id, v_desc)
    returning id into v_id;
    return v_id;
  end if;

  v_base := case p_type
    when 'asset' then 1000 when 'liability' then 2000 when 'equity' then 3000
    when 'income' then 4000 else 5000 end;
  select coalesce(max(code::integer), v_base) + 10 into v_next
  from accounts
  where entity_id = p_entity_id and type = p_type and code ~ '^[0-9]+$';
  if v_next >= v_base + 1000 then
    raise exception 'No free account numbers left for this type';
  end if;

  insert into accounts (workspace_id, entity_id, code, name, type, tax_line, description)
  values (v_workspace, p_entity_id, v_next::text, v_name, p_type, nullif(trim(p_tax_line), ''), v_desc)
  returning id into v_id;
  return v_id;
end $$;

create or replace function ensure_subaccount(p_parent_id uuid, p_name text, p_description text default null) returns uuid
language plpgsql
as $$
declare
  v_parent accounts%rowtype;
  v_id uuid;
begin
  select * into v_parent from accounts where id = p_parent_id;
  if not found then
    raise exception 'Parent category not found';
  end if;
  select id into v_id from accounts where parent_id = p_parent_id and lower(name) = lower(trim(p_name));
  if found then
    return v_id;
  end if;
  return create_account(v_parent.entity_id, p_parent_id, v_parent.type, p_name, null, p_description);
end $$;

-- New default charts come with descriptions.
create or replace function seed_default_chart(p_entity_id uuid) returns void
language plpgsql
as $$
declare
  v_workspace uuid;
begin
  select workspace_id into v_workspace from entities where id = p_entity_id;
  insert into accounts (workspace_id, entity_id, code, name, type, subtype, tax_line, is_bank, description) values
    (v_workspace, p_entity_id, '1000', 'Operating Checking',        'asset',     'cash',            null, true,  default_account_description('1000')),
    (v_workspace, p_entity_id, '1010', 'Security Deposit Account',  'asset',     'cash',            null, true,  default_account_description('1010')),
    (v_workspace, p_entity_id, '1100', 'Escrow Held by Lender',     'asset',     'escrow',          null, false, default_account_description('1100')),
    (v_workspace, p_entity_id, '1200', 'Rental Property (Cost)',    'asset',     'fixed_asset',     null, false, default_account_description('1200')),
    (v_workspace, p_entity_id, '1210', 'Accumulated Depreciation',  'asset',     'contra_asset',    null, false, default_account_description('1210')),
    (v_workspace, p_entity_id, '2000', 'Security Deposits Held',    'liability', 'deposits',        null, false, default_account_description('2000')),
    (v_workspace, p_entity_id, '2100', 'Mortgage Payable',          'liability', 'loan',            null, false, default_account_description('2100')),
    (v_workspace, p_entity_id, '2200', 'Credit Card',               'liability', 'credit_card',     null, false, default_account_description('2200')),
    (v_workspace, p_entity_id, '3000', 'Owner Contributions',       'equity',    'contributions',   null, false, default_account_description('3000')),
    (v_workspace, p_entity_id, '3100', 'Owner Distributions',       'equity',    'distributions',   null, false, default_account_description('3100')),
    (v_workspace, p_entity_id, '3900', 'Retained Earnings',         'equity',    'retained',        null, false, default_account_description('3900')),
    (v_workspace, p_entity_id, '4000', 'Rental Income',             'income',    'rent',            'sched_e.rents_received', false, default_account_description('4000')),
    (v_workspace, p_entity_id, '4010', 'Section 8 Rental Income',   'income',    'rent',            'sched_e.rents_received', false, default_account_description('4010')),
    (v_workspace, p_entity_id, '4100', 'Late Fees & Other Income',  'income',    'other',           'sched_e.rents_received', false, default_account_description('4100')),
    (v_workspace, p_entity_id, '5000', 'Advertising',               'expense',   'advertising',     'sched_e.advertising', false, default_account_description('5000')),
    (v_workspace, p_entity_id, '5010', 'Auto & Travel',             'expense',   'travel',          'sched_e.auto_travel', false, default_account_description('5010')),
    (v_workspace, p_entity_id, '5020', 'Cleaning & Maintenance',    'expense',   'cleaning',        'sched_e.cleaning_maintenance', false, default_account_description('5020')),
    (v_workspace, p_entity_id, '5030', 'Commissions & Leasing Fees','expense',   'commissions',     'sched_e.commissions', false, default_account_description('5030')),
    (v_workspace, p_entity_id, '5040', 'Insurance',                 'expense',   'insurance',       'sched_e.insurance', false, default_account_description('5040')),
    (v_workspace, p_entity_id, '5050', 'Legal & Professional Fees', 'expense',   'professional',    'sched_e.legal_professional', false, default_account_description('5050')),
    (v_workspace, p_entity_id, '5060', 'Management Fees',           'expense',   'management',      'sched_e.management_fees', false, default_account_description('5060')),
    (v_workspace, p_entity_id, '5070', 'Mortgage Interest',         'expense',   'interest',        'sched_e.mortgage_interest', false, default_account_description('5070')),
    (v_workspace, p_entity_id, '5080', 'Other Interest',            'expense',   'interest',        'sched_e.other_interest', false, default_account_description('5080')),
    (v_workspace, p_entity_id, '5090', 'Repairs',                   'expense',   'repairs',         'sched_e.repairs', false, default_account_description('5090')),
    (v_workspace, p_entity_id, '5100', 'Supplies',                  'expense',   'supplies',        'sched_e.supplies', false, default_account_description('5100')),
    (v_workspace, p_entity_id, '5110', 'Property Taxes',            'expense',   'taxes',           'sched_e.taxes', false, default_account_description('5110')),
    (v_workspace, p_entity_id, '5120', 'Utilities',                 'expense',   'utilities',       'sched_e.utilities', false, default_account_description('5120')),
    (v_workspace, p_entity_id, '5130', 'Depreciation',              'expense',   'depreciation',    'sched_e.depreciation', false, default_account_description('5130')),
    (v_workspace, p_entity_id, '5140', 'Bank Fees & Other Expenses','expense',   'other',           'sched_e.other', false, default_account_description('5140'));
end $$;
