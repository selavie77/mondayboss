-- Import support: a per-batch summary for the import history, and a fast duplicate check.

create view import_batch_summary with (security_invoker = true) as
select
  b.id as batch_id,
  b.workspace_id,
  b.entity_id,
  b.source,
  b.filename,
  b.created_at,
  count(s.id)::int as imported,
  count(s.id) filter (where s.status = 'posted')::int as posted,
  count(s.id) filter (where s.status = 'pending')::int as pending,
  count(s.id) filter (where s.status = 'ignored')::int as ignored
from import_batches b
left join statement_lines s on s.batch_id = b.id
group by b.id;

-- Which of these row fingerprints were already imported for the entity? Sent as one array so the
-- request body, not the URL, carries the list.
create or replace function existing_import_hashes(p_entity_id uuid, p_hashes text[]) returns setof text
language sql
stable
as $$
  select dedupe_hash from statement_lines where entity_id = p_entity_id and dedupe_hash = any (p_hashes)
$$;
