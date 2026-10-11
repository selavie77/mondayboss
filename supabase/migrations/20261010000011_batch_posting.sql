-- Post many pending statement lines in one call (one database round trip instead of one per line).
-- p_items: [{ "line_id": uuid, "lines": [{account_id, property_id, debit_cents, credit_cents}, ...] }]
-- The whole call is atomic: if any line is rejected, none of them are posted.
create or replace function post_statement_lines_batch(p_items jsonb) returns integer
language plpgsql
as $$
declare
  v_item jsonb;
  v_n integer := 0;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    perform post_statement_line((v_item ->> 'line_id')::uuid, v_item -> 'lines');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
