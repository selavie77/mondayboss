-- Mondayboss ledger core: workspaces, portfolios, entities, properties,
-- chart of accounts, and an always-balanced, immutable double-entry journal.
-- Money is stored as integer cents (USD).


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type entity_type as enum ('individual', 'llc', 's_corp', 'c_corp', 'partnership', 'trust');
create type account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type rental_type as enum ('long_term', 'short_term', 'mixed', 'owner_occupied');
create type member_role as enum ('owner', 'admin', 'member');
create type entry_source as enum ('manual', 'import', 'system', 'reversal');
create type statement_line_status as enum ('pending', 'posted', 'ignored');

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);

create or replace function is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Portfolios, entities, properties
-- ---------------------------------------------------------------------------
create table portfolios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, name)
);

create table entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  type entity_type not null default 'llc',
  ein text,
  -- Cash basis for v1; accrual can be added later without a schema change.
  accounting_basis text not null default 'cash' check (accounting_basis in ('cash', 'accrual')),
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  -- Entries dated on or before this date cannot be posted (period lock).
  books_locked_through date,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, name)
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  portfolio_id uuid not null,
  entity_id uuid not null,
  name text not null,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  rental_type rental_type not null default 'long_term',
  acquired_on date,
  placed_in_service_on date,
  purchase_price_cents bigint check (purchase_price_cents is null or purchase_price_cents >= 0),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, name),
  foreign key (portfolio_id, workspace_id) references portfolios (id, workspace_id),
  foreign key (entity_id, workspace_id) references entities (id, workspace_id)
);
create index on properties (portfolio_id);
create index on properties (entity_id);

-- ---------------------------------------------------------------------------
-- Chart of accounts (per entity)
-- ---------------------------------------------------------------------------
create table accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entity_id uuid not null,
  code text not null,
  name text not null,
  type account_type not null,
  subtype text,
  -- Tax form line this account rolls into, e.g. 'sched_e.mortgage_interest'.
  tax_line text,
  is_bank boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, entity_id),
  unique (entity_id, code),
  foreign key (entity_id, workspace_id) references entities (id, workspace_id)
);
create index on accounts (workspace_id);

-- ---------------------------------------------------------------------------
-- Import staging (statement rows live here until posted to the ledger)
-- ---------------------------------------------------------------------------
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entity_id uuid not null,
  source text not null,
  filename text,
  row_count integer not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, entity_id),
  foreign key (entity_id, workspace_id) references entities (id, workspace_id)
);

-- ---------------------------------------------------------------------------
-- Journal
-- ---------------------------------------------------------------------------
create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entity_id uuid not null,
  entry_date date not null,
  memo text,
  source entry_source not null default 'manual',
  import_batch_id uuid,
  reverses_entry_id uuid references journal_entries (id),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, entity_id),
  foreign key (entity_id, workspace_id) references entities (id, workspace_id),
  foreign key (import_batch_id, entity_id) references import_batches (id, entity_id)
);
create index on journal_entries (entity_id, entry_date);
create unique index journal_entries_one_reversal on journal_entries (reverses_entry_id)
  where reverses_entry_id is not null;

create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entity_id uuid not null,
  entry_id uuid not null,
  account_id uuid not null,
  property_id uuid,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  memo text,
  -- Exactly one side carries an amount.
  check ((debit_cents > 0 and credit_cents = 0) or (credit_cents > 0 and debit_cents = 0)),
  foreign key (entry_id, entity_id) references journal_entries (id, entity_id),
  foreign key (account_id, entity_id) references accounts (id, entity_id),
  foreign key (property_id, workspace_id) references properties (id, workspace_id)
);
create index on journal_lines (entry_id);
create index on journal_lines (account_id);
create index on journal_lines (property_id);
create index on journal_lines (entity_id);

create table statement_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entity_id uuid not null,
  batch_id uuid not null,
  account_id uuid,                       -- bank/card/loan account this row belongs to
  txn_date date not null,
  description text not null,
  -- Signed from the account holder's perspective: money in positive, money out negative.
  amount_cents bigint not null,
  raw jsonb not null default '{}'::jsonb,
  dedupe_hash text not null,
  status statement_line_status not null default 'pending',
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (entity_id, dedupe_hash),
  foreign key (batch_id, entity_id) references import_batches (id, entity_id),
  foreign key (account_id, entity_id) references accounts (id, entity_id),
  foreign key (journal_entry_id, entity_id) references journal_entries (id, entity_id)
);
create index on statement_lines (batch_id);

-- ---------------------------------------------------------------------------
-- Reconciliations
-- ---------------------------------------------------------------------------
create table reconciliations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entity_id uuid not null,
  account_id uuid not null,
  period_end date not null,
  statement_ending_balance_cents bigint not null,
  ledger_balance_cents bigint not null,
  difference_cents bigint generated always as (statement_ending_balance_cents - ledger_balance_cents) stored,
  reconciled_at timestamptz,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (account_id, period_end),
  foreign key (account_id, entity_id) references accounts (id, entity_id),
  foreign key (entity_id, workspace_id) references entities (id, workspace_id)
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid,
  table_name text not null,
  row_id uuid,
  action text not null,
  old_row jsonb,
  new_row jsonb,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);
create index on audit_log (workspace_id, at desc);

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log (workspace_id, table_name, row_id, action, old_row, new_row)
  values (
    nullif(r ->> 'workspace_id', '')::uuid,
    tg_table_name,
    nullif(r ->> 'id', '')::uuid,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_portfolios after insert or update or delete on portfolios for each row execute function audit_row();
create trigger audit_entities after insert or update or delete on entities for each row execute function audit_row();
create trigger audit_properties after insert or update or delete on properties for each row execute function audit_row();
create trigger audit_accounts after insert or update or delete on accounts for each row execute function audit_row();
create trigger audit_reconciliations after insert or update or delete on reconciliations for each row execute function audit_row();

-- ---------------------------------------------------------------------------
-- Ledger integrity
-- ---------------------------------------------------------------------------

-- 1. Every entry balances and has at least two lines, checked at commit.
create or replace function assert_entry_balanced() returns trigger
language plpgsql as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
  v_debits bigint;
  v_credits bigint;
  v_lines integer;
begin
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0), count(*)
    into v_debits, v_credits, v_lines
  from journal_lines where entry_id = v_entry;

  if v_lines < 2 then
    raise exception 'Journal entry % must have at least two lines', v_entry using errcode = '23514';
  end if;
  if v_debits <> v_credits then
    raise exception 'Journal entry % is out of balance: debits % <> credits %', v_entry, v_debits, v_credits
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger journal_lines_balanced
  after insert on journal_lines
  deferrable initially deferred
  for each row execute function assert_entry_balanced();

-- An entry created without any lines is also invalid.
create or replace function assert_entry_has_lines() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from journal_lines where entry_id = new.id) then
    raise exception 'Journal entry % has no lines', new.id using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger journal_entries_have_lines
  after insert on journal_entries
  deferrable initially deferred
  for each row execute function assert_entry_has_lines();

-- 2. Posted entries are immutable. Corrections are made with reversal entries.
create or replace function forbid_ledger_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Ledger rows are immutable; post a reversing entry instead (% on %)', tg_op, tg_table_name
    using errcode = '42501';
end $$;

create trigger journal_entries_immutable
  before update or delete on journal_entries
  for each row execute function forbid_ledger_mutation();
create trigger journal_lines_immutable
  before update or delete on journal_lines
  for each row execute function forbid_ledger_mutation();

-- 3. Period lock: nothing may be posted on or before books_locked_through.
create or replace function enforce_period_lock() returns trigger
language plpgsql as $$
declare
  v_locked date;
begin
  select books_locked_through into v_locked from entities where id = new.entity_id;
  if v_locked is not null and new.entry_date <= v_locked then
    raise exception 'Books are locked through %; cannot post an entry dated %', v_locked, new.entry_date
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger journal_entries_period_lock
  before insert on journal_entries
  for each row execute function enforce_period_lock();

-- 4. A reversal must mirror the original: same entity, opposite sides.
create or replace function enforce_reversal_shape() returns trigger
language plpgsql as $$
declare
  v_orig_entity uuid;
begin
  if new.reverses_entry_id is null then
    return new;
  end if;
  select entity_id into v_orig_entity from journal_entries where id = new.reverses_entry_id;
  if v_orig_entity is distinct from new.entity_id then
    raise exception 'A reversal must belong to the same entity as the original entry' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger journal_entries_reversal_shape
  before insert on journal_entries
  for each row execute function enforce_reversal_shape();

-- ---------------------------------------------------------------------------
-- Posting API (atomic: entry + lines in one transaction)
-- ---------------------------------------------------------------------------
-- p_lines: [{ "account_id": uuid, "property_id": uuid|null,
--             "debit_cents": int, "credit_cents": int, "memo": text }]
create or replace function post_entry(
  p_entity_id uuid,
  p_entry_date date,
  p_memo text,
  p_lines jsonb,
  p_source entry_source default 'manual',
  p_import_batch_id uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_workspace uuid;
  v_entry uuid;
  v_line jsonb;
begin
  select workspace_id into v_workspace from entities where id = p_entity_id;
  if v_workspace is null then
    raise exception 'Entity % not found', p_entity_id;
  end if;

  insert into journal_entries (workspace_id, entity_id, entry_date, memo, source, import_batch_id)
  values (v_workspace, p_entity_id, p_entry_date, p_memo, p_source, p_import_batch_id)
  returning id into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (workspace_id, entity_id, entry_id, account_id, property_id, debit_cents, credit_cents, memo)
    values (
      v_workspace, p_entity_id, v_entry,
      (v_line ->> 'account_id')::uuid,
      nullif(v_line ->> 'property_id', '')::uuid,
      coalesce((v_line ->> 'debit_cents')::bigint, 0),
      coalesce((v_line ->> 'credit_cents')::bigint, 0),
      v_line ->> 'memo'
    );
  end loop;

  return v_entry;
end $$;

-- Reverse an entry by posting the mirror-image lines.
create or replace function reverse_entry(p_entry_id uuid, p_entry_date date default current_date, p_memo text default null)
returns uuid
language plpgsql
as $$
declare
  v_orig journal_entries%rowtype;
  v_new uuid;
begin
  select * into v_orig from journal_entries where id = p_entry_id;
  if not found then
    raise exception 'Entry % not found', p_entry_id;
  end if;

  insert into journal_entries (workspace_id, entity_id, entry_date, memo, source, reverses_entry_id)
  values (v_orig.workspace_id, v_orig.entity_id, p_entry_date,
          coalesce(p_memo, 'Reversal of ' || coalesce(v_orig.memo, v_orig.id::text)), 'reversal', v_orig.id)
  returning id into v_new;

  insert into journal_lines (workspace_id, entity_id, entry_id, account_id, property_id, debit_cents, credit_cents, memo)
  select workspace_id, entity_id, v_new, account_id, property_id, credit_cents, debit_cents, memo
  from journal_lines where entry_id = p_entry_id;

  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Reporting views (security_invoker so RLS applies to the caller)
-- ---------------------------------------------------------------------------
create view trial_balance with (security_invoker = true) as
select
  a.workspace_id,
  a.entity_id,
  a.id as account_id,
  a.code,
  a.name,
  a.type,
  coalesce(sum(l.debit_cents), 0)::bigint as debit_cents,
  coalesce(sum(l.credit_cents), 0)::bigint as credit_cents,
  coalesce(sum(l.debit_cents - l.credit_cents), 0)::bigint as balance_cents -- debit-positive
from accounts a
left join journal_lines l on l.account_id = a.id
group by a.workspace_id, a.entity_id, a.id, a.code, a.name, a.type;

-- Income and expense activity by property and month (positive = natural direction).
create view property_pnl_monthly with (security_invoker = true) as
select
  l.workspace_id,
  l.entity_id,
  l.property_id,
  date_trunc('month', e.entry_date)::date as month,
  a.id as account_id,
  a.code,
  a.name,
  a.type,
  a.tax_line,
  case when a.type = 'income' then sum(l.credit_cents - l.debit_cents)
       else sum(l.debit_cents - l.credit_cents) end::bigint as amount_cents
from journal_lines l
join journal_entries e on e.id = l.entry_id
join accounts a on a.id = l.account_id
where a.type in ('income', 'expense')
group by l.workspace_id, l.entity_id, l.property_id, date_trunc('month', e.entry_date), a.id, a.code, a.name, a.type, a.tax_line;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table portfolios enable row level security;
alter table entities enable row level security;
alter table properties enable row level security;
alter table accounts enable row level security;
alter table import_batches enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
alter table statement_lines enable row level security;
alter table reconciliations enable row level security;
alter table audit_log enable row level security;

create policy workspaces_select on workspaces for select using (is_workspace_member(id));
create policy workspaces_update on workspaces for update using (is_workspace_member(id));

create policy members_select on workspace_members for select using (is_workspace_member(workspace_id));

-- Tables scoped by workspace_id: members can read and write their own workspace only.
do $$
declare t text;
begin
  foreach t in array array['portfolios','entities','properties','accounts','import_batches',
                           'journal_entries','journal_lines','statement_lines','reconciliations']
  loop
    execute format('create policy %I_select on %I for select using (is_workspace_member(workspace_id))', t, t);
    execute format('create policy %I_insert on %I for insert with check (is_workspace_member(workspace_id))', t, t);
  end loop;
  -- Mutable tables also allow update/delete; the journal tables stay append-only.
  foreach t in array array['portfolios','entities','properties','accounts','statement_lines','reconciliations']
  loop
    execute format('create policy %I_update on %I for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id))', t, t);
  end loop;
  foreach t in array array['portfolios','properties','statement_lines']
  loop
    execute format('create policy %I_delete on %I for delete using (is_workspace_member(workspace_id))', t, t);
  end loop;
end $$;

create policy audit_select on audit_log for select using (is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Sign-up: every new user gets a workspace and a default portfolio.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_workspace uuid;
begin
  insert into workspaces (name, created_by)
  values (coalesce(new.raw_user_meta_data ->> 'workspace_name', 'My workspace'), new.id)
  returning id into v_workspace;

  insert into workspace_members (workspace_id, user_id, role) values (v_workspace, new.id, 'owner');
  insert into portfolios (workspace_id, name) values (v_workspace, 'My portfolio');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Default chart of accounts for a rental entity
-- ---------------------------------------------------------------------------
create or replace function seed_default_chart(p_entity_id uuid) returns void
language plpgsql
as $$
declare
  v_workspace uuid;
begin
  select workspace_id into v_workspace from entities where id = p_entity_id;
  insert into accounts (workspace_id, entity_id, code, name, type, subtype, tax_line, is_bank) values
    (v_workspace, p_entity_id, '1000', 'Operating Checking',        'asset',     'cash',            null, true),
    (v_workspace, p_entity_id, '1010', 'Security Deposit Account',  'asset',     'cash',            null, true),
    (v_workspace, p_entity_id, '1100', 'Escrow Held by Lender',     'asset',     'escrow',          null, false),
    (v_workspace, p_entity_id, '1200', 'Rental Property (Cost)',    'asset',     'fixed_asset',     null, false),
    (v_workspace, p_entity_id, '1210', 'Accumulated Depreciation',  'asset',     'contra_asset',    null, false),
    (v_workspace, p_entity_id, '2000', 'Security Deposits Held',    'liability', 'deposits',        null, false),
    (v_workspace, p_entity_id, '2100', 'Mortgage Payable',          'liability', 'loan',            null, false),
    (v_workspace, p_entity_id, '2200', 'Credit Card',               'liability', 'credit_card',     null, false),
    (v_workspace, p_entity_id, '3000', 'Owner Contributions',       'equity',    'contributions',   null, false),
    (v_workspace, p_entity_id, '3100', 'Owner Distributions',       'equity',    'distributions',   null, false),
    (v_workspace, p_entity_id, '3900', 'Retained Earnings',         'equity',    'retained',        null, false),
    (v_workspace, p_entity_id, '4000', 'Rental Income',             'income',    'rent',            'sched_e.rents_received', false),
    (v_workspace, p_entity_id, '4010', 'Section 8 Rental Income',   'income',    'rent',            'sched_e.rents_received', false),
    (v_workspace, p_entity_id, '4100', 'Late Fees & Other Income',  'income',    'other',           'sched_e.rents_received', false),
    (v_workspace, p_entity_id, '5000', 'Advertising',               'expense',   'advertising',     'sched_e.advertising', false),
    (v_workspace, p_entity_id, '5010', 'Auto & Travel',             'expense',   'travel',          'sched_e.auto_travel', false),
    (v_workspace, p_entity_id, '5020', 'Cleaning & Maintenance',    'expense',   'cleaning',        'sched_e.cleaning_maintenance', false),
    (v_workspace, p_entity_id, '5030', 'Commissions & Leasing Fees','expense',   'commissions',     'sched_e.commissions', false),
    (v_workspace, p_entity_id, '5040', 'Insurance',                 'expense',   'insurance',       'sched_e.insurance', false),
    (v_workspace, p_entity_id, '5050', 'Legal & Professional Fees', 'expense',   'professional',    'sched_e.legal_professional', false),
    (v_workspace, p_entity_id, '5060', 'Management Fees',           'expense',   'management',      'sched_e.management_fees', false),
    (v_workspace, p_entity_id, '5070', 'Mortgage Interest',         'expense',   'interest',        'sched_e.mortgage_interest', false),
    (v_workspace, p_entity_id, '5080', 'Other Interest',            'expense',   'interest',        'sched_e.other_interest', false),
    (v_workspace, p_entity_id, '5090', 'Repairs',                   'expense',   'repairs',         'sched_e.repairs', false),
    (v_workspace, p_entity_id, '5100', 'Supplies',                  'expense',   'supplies',        'sched_e.supplies', false),
    (v_workspace, p_entity_id, '5110', 'Property Taxes',            'expense',   'taxes',           'sched_e.taxes', false),
    (v_workspace, p_entity_id, '5120', 'Utilities',                 'expense',   'utilities',       'sched_e.utilities', false),
    (v_workspace, p_entity_id, '5130', 'Depreciation',              'expense',   'depreciation',    'sched_e.depreciation', false),
    (v_workspace, p_entity_id, '5140', 'Bank Fees & Other Expenses','expense',   'other',           'sched_e.other', false);
end $$;
