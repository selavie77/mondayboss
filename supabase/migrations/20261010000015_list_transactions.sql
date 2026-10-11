-- One page of transactions (journal entries) for the Transactions screen, newest first.
-- Filters: period, businesses, properties, an account code, and a text search on the description.
-- Reversed entries and the reversals that cancel them are hidden unless p_show_reversed is set.
-- Runs as the caller, so row level security limits it to the signed-in workspace.
create or replace function list_transactions(
  p_from date,
  p_to date,
  p_entity_ids uuid[] default null,
  p_property_ids uuid[] default null,
  p_account_code text default null,
  p_search text default null,
  p_show_reversed boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  entity_id uuid,
  entry_date date,
  memo text,
  source entry_source,
  created_at timestamptz,
  reverses_entry_id uuid,
  is_reversed boolean,
  amount_cents bigint,
  total_count bigint
)
language sql
stable
as $$
  with e as (
    select je.*,
           exists (select 1 from journal_entries r where r.reverses_entry_id = je.id) as is_reversed
    from journal_entries je
    where je.entry_date between p_from and p_to
      and (p_entity_ids is null or je.entity_id = any (p_entity_ids))
      and (p_search is null or p_search = '' or je.memo ilike '%' || p_search || '%')
      and (p_property_ids is null or exists (
            select 1 from journal_lines l where l.entry_id = je.id and l.property_id = any (p_property_ids)))
      and (p_account_code is null or exists (
            select 1 from journal_lines l join accounts a on a.id = l.account_id
            where l.entry_id = je.id and a.code = p_account_code))
  ), f as (
    select * from e where p_show_reversed or (not e.is_reversed and e.reverses_entry_id is null)
  )
  select f.id, f.entity_id, f.entry_date, f.memo, f.source, f.created_at, f.reverses_entry_id, f.is_reversed,
         (select coalesce(sum(l.debit_cents), 0) from journal_lines l where l.entry_id = f.id)::bigint,
         count(*) over ()
  from f
  order by f.entry_date desc, f.created_at desc, f.id
  limit p_limit offset p_offset
$$;
