-- Review queue: imported rows that need a human decision before they reach the ledger.

alter table statement_lines
  add column property_id uuid,
  add column review_reason text,
  add column proposed_debit_account_id uuid,
  add column proposed_credit_account_id uuid,
  add foreign key (property_id, workspace_id) references properties (id, workspace_id),
  add foreign key (proposed_debit_account_id, entity_id) references accounts (id, entity_id),
  add foreign key (proposed_credit_account_id, entity_id) references accounts (id, entity_id);

create index statement_lines_pending on statement_lines (entity_id, txn_date) where status = 'pending';

-- Post one pending statement line to the ledger with the given journal lines.
-- The lines' debits must equal the transaction amount, so a row can never be posted for the wrong total.
create or replace function post_statement_line(p_line_id uuid, p_lines jsonb)
returns uuid
language plpgsql
as $$
declare
  v_line statement_lines%rowtype;
  v_entry uuid;
  v_debits bigint;
begin
  select * into v_line from statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'Statement line % not found', p_line_id;
  end if;
  if v_line.status <> 'pending' then
    raise exception 'Statement line % is already %', p_line_id, v_line.status;
  end if;

  select coalesce(sum((l ->> 'debit_cents')::bigint), 0) into v_debits
  from jsonb_array_elements(p_lines) l;
  if v_debits <> abs(v_line.amount_cents) then
    raise exception 'Lines total % but the transaction is %', v_debits, abs(v_line.amount_cents);
  end if;

  v_entry := post_entry(v_line.entity_id, v_line.txn_date, v_line.description, p_lines, 'import', v_line.batch_id);
  update statement_lines set status = 'posted', journal_entry_id = v_entry where id = p_line_id;
  return v_entry;
end $$;

-- Accept the proposed categorization for many lines at once. Returns how many were posted.
create or replace function accept_statement_lines(p_ids uuid[])
returns integer
language plpgsql
as $$
declare
  v_line statement_lines%rowtype;
  v_n integer := 0;
  v_abs bigint;
begin
  for v_line in
    select * from statement_lines where id = any (p_ids) and status = 'pending' order by txn_date, id
  loop
    if v_line.proposed_debit_account_id is null or v_line.proposed_credit_account_id is null then
      raise exception 'Line % has no proposal to accept', v_line.id;
    end if;
    v_abs := abs(v_line.amount_cents);
    perform post_statement_line(v_line.id, jsonb_build_array(
      jsonb_build_object('account_id', v_line.proposed_debit_account_id, 'property_id', v_line.property_id, 'debit_cents', v_abs),
      jsonb_build_object('account_id', v_line.proposed_credit_account_id, 'property_id', v_line.property_id, 'credit_cents', v_abs)
    ));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
