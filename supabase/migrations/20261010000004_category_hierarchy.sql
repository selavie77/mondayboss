-- Two-level categories: a category can have subcategories, and subcategory totals roll up to it.
-- Both levels are postable (an amount with no subcategory belongs to the category itself).

alter table accounts
  add column parent_id uuid,
  add foreign key (parent_id, entity_id) references accounts (id, entity_id);
create index accounts_parent on accounts (parent_id);

-- Sibling names are unique (case-insensitive) within an entity.
create unique index accounts_sibling_name
  on accounts (entity_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create or replace function enforce_account_hierarchy() returns trigger
language plpgsql as $$
declare
  v_type account_type;
  v_grandparent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'A category cannot be its own subcategory' using errcode = '23514';
  end if;

  select type, parent_id into v_type, v_grandparent from accounts where id = new.parent_id;
  if v_type <> new.type then
    raise exception 'A subcategory must be the same type as its category (% vs %)', new.type, v_type
      using errcode = '23514';
  end if;
  if v_grandparent is not null then
    raise exception 'Categories can only go two levels deep' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and exists (select 1 from accounts where parent_id = new.id) then
    raise exception 'A category that has subcategories cannot become a subcategory' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger accounts_hierarchy
  before insert or update on accounts
  for each row execute function enforce_account_hierarchy();

-- Create a category (parent null) or a subcategory (parent given). Codes are generated:
--   categories:    next free number in the type's range (assets 1xxx ... expenses 5xxx), step 10
--   subcategories: <parent code>.<nn>
create or replace function create_account(
  p_entity_id uuid,
  p_parent_id uuid,
  p_type account_type,
  p_name text,
  p_tax_line text default null
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
    insert into accounts (workspace_id, entity_id, code, name, type, subtype, tax_line, parent_id)
    values (v_workspace, p_entity_id, v_code, v_name, v_parent.type, v_parent.subtype, null, p_parent_id)
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

  insert into accounts (workspace_id, entity_id, code, name, type, tax_line)
  values (v_workspace, p_entity_id, v_next::text, v_name, p_type, nullif(trim(p_tax_line), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Find a subcategory by name under a category, creating it if it does not exist yet.
create or replace function ensure_subaccount(p_parent_id uuid, p_name text) returns uuid
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
  return create_account(v_parent.entity_id, p_parent_id, v_parent.type, p_name);
end $$;

-- ---------------------------------------------------------------------------
-- Reporting views: expose the category each account rolls up to.
-- A subcategory inherits its category's tax line unless it has its own.
-- ---------------------------------------------------------------------------
drop view property_pnl_monthly;
drop view trial_balance;

create view trial_balance with (security_invoker = true) as
select
  a.workspace_id,
  a.entity_id,
  a.id as account_id,
  a.parent_id,
  coalesce(p.id, a.id) as category_id,
  coalesce(p.name, a.name) as category_name,
  a.code,
  a.name,
  a.type,
  coalesce(sum(l.debit_cents), 0)::bigint as debit_cents,
  coalesce(sum(l.credit_cents), 0)::bigint as credit_cents,
  coalesce(sum(l.debit_cents - l.credit_cents), 0)::bigint as balance_cents -- debit-positive
from accounts a
left join accounts p on p.id = a.parent_id
left join journal_lines l on l.account_id = a.id
group by a.workspace_id, a.entity_id, a.id, a.parent_id, p.id, p.name, a.code, a.name, a.type;

create view property_pnl_monthly with (security_invoker = true) as
select
  l.workspace_id,
  l.entity_id,
  l.property_id,
  date_trunc('month', e.entry_date)::date as month,
  a.id as account_id,
  coalesce(p.id, a.id) as category_id,
  coalesce(p.name, a.name) as category_name,
  a.code,
  a.name,
  a.type,
  coalesce(a.tax_line, p.tax_line) as tax_line,
  case when a.type = 'income' then sum(l.credit_cents - l.debit_cents)
       else sum(l.debit_cents - l.credit_cents) end::bigint as amount_cents
from journal_lines l
join journal_entries e on e.id = l.entry_id
join accounts a on a.id = l.account_id
left join accounts p on p.id = a.parent_id
where a.type in ('income', 'expense')
group by l.workspace_id, l.entity_id, l.property_id, date_trunc('month', e.entry_date),
         a.id, p.id, p.name, a.name, a.code, a.type, a.tax_line, p.tax_line;
