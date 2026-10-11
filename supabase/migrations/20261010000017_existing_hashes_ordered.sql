-- Stable order, so a caller can read the result one page at a time (the API returns at most 1,000 rows per call).
create or replace function existing_import_hashes(p_entity_id uuid, p_hashes text[]) returns setof text
language sql
stable
as $$
  select dedupe_hash from statement_lines where entity_id = p_entity_id and dedupe_hash = any (p_hashes) order by dedupe_hash
$$;
