-- Reporting support: one activity query that every report is built from, and a register of capital expenses.

-- Net debit-minus-credit per account for a period, grouped for a report's columns:
--   p_group = 'property' -> one bucket ('all'), split by property (untagged lines come back with a null property)
--   p_group = 'month' | 'quarter' | 'year' -> one bucket per period, all properties combined
--   p_group = 'total' -> everything in one bucket
-- Row level security applies, so a caller only ever sees their own workspace.
create or replace function report_activity(
  p_from date,
  p_to date,
  p_group text default 'property',
  p_property_ids uuid[] default null,
  p_entity_ids uuid[] default null
) returns table (bucket text, property_id uuid, account_id uuid, net_cents bigint)
language sql
stable
as $$
  select
    case p_group
      when 'month' then to_char(e.entry_date, 'YYYY-MM')
      when 'quarter' then to_char(e.entry_date, 'YYYY') || '-Q' || to_char(e.entry_date, 'Q')
      when 'year' then to_char(e.entry_date, 'YYYY')
      else 'all'
    end as bucket,
    case when p_group = 'property' then l.property_id end as property_id,
    l.account_id,
    sum(l.debit_cents - l.credit_cents)::bigint as net_cents
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  where e.entry_date between p_from and p_to
    and (p_entity_ids is null or l.entity_id = any (p_entity_ids))
    and (p_property_ids is null or l.property_id = any (p_property_ids))
  group by 1, 2, 3
  order by 1, 2, 3
$$;

-- Capital expenses (acquisitions, improvements, equipment) with the facts depreciation needs.
create table capital_expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  property_id uuid not null,
  name text not null,
  sub_category text not null default 'Improvements',
  amount_cents bigint not null check (amount_cents > 0),
  spent_on date not null,
  placed_in_service_on date,
  useful_life_years numeric(4, 1) not null default 27.5 check (useful_life_years > 0),
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (property_id, workspace_id) references properties (id, workspace_id)
);
create index on capital_expenses (property_id, spent_on);

alter table capital_expenses enable row level security;
create policy capital_expenses_select on capital_expenses for select using (is_workspace_member(workspace_id));
create policy capital_expenses_insert on capital_expenses for insert with check (is_workspace_member(workspace_id));
create policy capital_expenses_update on capital_expenses for update
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy capital_expenses_delete on capital_expenses for delete using (is_workspace_member(workspace_id));

create trigger audit_capital_expenses after insert or update or delete on capital_expenses
  for each row execute function audit_row();
