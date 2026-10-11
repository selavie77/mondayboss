-- Bank reconciliation, and undoing an import.
--
-- Reconciliation: tick off the transactions that appear on a statement until the account's cleared balance
-- equals the statement's ending balance. A journal line can be reconciled once. Journal rows themselves never
-- change, so the ticks live in their own table.
--
-- Undo import: reverse every transaction an import posted and remove its rows from Review, so the same file
-- can be imported again.

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------
create table reconciliation_lines (
  journal_line_id uuid primary key references journal_lines (id),
  reconciliation_id uuid not null references reconciliations (id) on delete cascade,
  workspace_id uuid not null
);
create index on reconciliation_lines (reconciliation_id);

alter table reconciliation_lines enable row level security;
create policy reconciliation_lines_select on reconciliation_lines for select using (is_workspace_member(workspace_id));
create policy reconciliation_lines_insert on reconciliation_lines for insert with check (is_workspace_member(workspace_id));
create policy reconciliation_lines_delete on reconciliation_lines for delete using (is_workspace_member(workspace_id));
create policy reconciliations_delete on reconciliations for delete using (is_workspace_member(workspace_id));

-- A bank account's or card's transactions that are not reconciled yet, through a date, oldest first.
create or replace function unreconciled_lines(p_account_id uuid, p_through date)
returns table (line_id uuid, entry_id uuid, entry_date date, memo text, source entry_source, property_id uuid,
               debit_cents bigint, credit_cents bigint, other_accounts text)
language sql
stable
as $$
  select l.id, e.id, e.entry_date, e.memo, e.source, l.property_id, l.debit_cents, l.credit_cents,
         (select string_agg(distinct a2.name, ', ')
            from journal_lines l2 join accounts a2 on a2.id = l2.account_id
           where l2.entry_id = e.id and l2.id <> l.id)
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  where l.account_id = p_account_id
    and e.entry_date <= p_through
    and not exists (select 1 from reconciliation_lines r where r.journal_line_id = l.id)
  order by e.entry_date, e.created_at, l.id
$$;

-- What the account's reconciled transactions add up to, in its normal direction (money in a bank account,
-- or money owed on a card).
create or replace function reconciled_balance(p_account_id uuid) returns bigint
language sql
stable
as $$
  select coalesce(sum(case when a.type = 'asset' and coalesce(a.subtype, '') <> 'contra_asset'
                           then l.debit_cents - l.credit_cents
                           else l.credit_cents - l.debit_cents end), 0)::bigint
  from reconciliation_lines r
  join journal_lines l on l.id = r.journal_line_id
  join accounts a on a.id = l.account_id
  where l.account_id = p_account_id
$$;

-- Finish a reconciliation: the opening point (everything reconciled before) plus the ticked lines must equal
-- the statement's ending balance exactly.
create or replace function complete_reconciliation(p_account_id uuid, p_period_end date, p_statement_cents bigint, p_line_ids uuid[])
returns uuid
language plpgsql
as $$
declare
  v_acct accounts%rowtype;
  v_prior bigint;
  v_ticked bigint;
  v_found integer;
  v_cleared bigint;
  v_last date;
  v_id uuid;
begin
  select * into v_acct from accounts where id = p_account_id;
  if not found then
    raise exception 'Account not found';
  end if;
  if v_acct.type not in ('asset', 'liability') then
    raise exception 'Only bank accounts and credit cards can be reconciled';
  end if;
  if p_line_ids is null or cardinality(p_line_ids) = 0 then
    raise exception 'Tick at least one transaction';
  end if;

  select max(period_end) into v_last from reconciliations where account_id = p_account_id and reconciled_at is not null;
  if v_last is not null and p_period_end <= v_last then
    raise exception 'This account is already reconciled through %. Choose a later statement date, or undo that reconciliation first.', v_last;
  end if;

  select count(*), coalesce(sum(case when v_acct.type = 'asset' and coalesce(v_acct.subtype, '') <> 'contra_asset'
                                     then l.debit_cents - l.credit_cents
                                     else l.credit_cents - l.debit_cents end), 0)
    into v_found, v_ticked
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  where l.id = any (p_line_ids)
    and l.account_id = p_account_id
    and e.entry_date <= p_period_end
    and not exists (select 1 from reconciliation_lines r where r.journal_line_id = l.id);
  if v_found <> cardinality(p_line_ids) then
    raise exception 'Some of the ticked transactions are not available to reconcile. Reload the page and try again.';
  end if;

  v_prior := reconciled_balance(p_account_id);
  v_cleared := v_prior + v_ticked;
  if v_cleared <> p_statement_cents then
    raise exception 'The cleared balance is % but the statement says %. The difference is %.',
      to_char(v_cleared / 100.0, 'FM999,999,999,990.00'), to_char(p_statement_cents / 100.0, 'FM999,999,999,990.00'),
      to_char((p_statement_cents - v_cleared) / 100.0, 'FM999,999,999,990.00');
  end if;

  insert into reconciliations (workspace_id, entity_id, account_id, period_end, statement_ending_balance_cents, ledger_balance_cents, reconciled_at)
  values (v_acct.workspace_id, v_acct.entity_id, p_account_id, p_period_end, p_statement_cents, v_cleared, now())
  returning id into v_id;

  insert into reconciliation_lines (journal_line_id, reconciliation_id, workspace_id)
  select unnest(p_line_ids), v_id, v_acct.workspace_id;
  return v_id;
end $$;

-- Undo a reconciliation, only the latest one for its account, so the transactions can be reconciled again.
create or replace function undo_reconciliation(p_id uuid) returns void
language plpgsql
as $$
declare
  v_rec reconciliations%rowtype;
begin
  select * into v_rec from reconciliations where id = p_id;
  if not found then
    raise exception 'Reconciliation not found';
  end if;
  if exists (select 1 from reconciliations where account_id = v_rec.account_id and period_end > v_rec.period_end) then
    raise exception 'Only the latest reconciliation can be undone. Undo the later one first.';
  end if;
  delete from reconciliation_lines where reconciliation_id = p_id;
  delete from reconciliations where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Undo an import
-- ---------------------------------------------------------------------------
alter table import_batches add column undone_at timestamptz;
create policy import_batches_update on import_batches for update
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create or replace view import_batch_summary with (security_invoker = true) as
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
  count(s.id) filter (where s.status = 'ignored')::int as ignored,
  b.undone_at
from import_batches b
left join statement_lines s on s.batch_id = b.id
group by b.id;

-- Reverse up to p_limit of an import's transactions (each on its own date, or today when that period is locked).
-- Call again until done is true: the last call removes the rows waiting in Review and marks the import undone.
-- Done in steps so a large import does not run into the database's time limit.
create or replace function undo_import_batch(p_batch_id uuid, p_limit integer default 300)
returns table (reversed integer, remaining integer, done boolean)
language plpgsql
as $$
declare
  v_batch import_batches%rowtype;
  v_locked date;
  v_entry record;
  v_n integer := 0;
  v_left integer;
begin
  select * into v_batch from import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Import not found';
  end if;
  if v_batch.undone_at is not null then
    raise exception 'This import was already undone';
  end if;
  if exists (
    select 1
    from reconciliation_lines rl
    join journal_lines l on l.id = rl.journal_line_id
    join journal_entries e on e.id = l.entry_id
    where e.import_batch_id = p_batch_id
  ) then
    raise exception 'Some of these transactions are part of a bank reconciliation. Undo that reconciliation first.';
  end if;

  select books_locked_through into v_locked from entities where id = v_batch.entity_id;

  for v_entry in
    select e.id, e.entry_date, e.memo
    from journal_entries e
    where e.import_batch_id = p_batch_id
      and e.reverses_entry_id is null
      and not exists (select 1 from journal_entries r where r.reverses_entry_id = e.id)
    order by e.entry_date, e.created_at
    limit p_limit
  loop
    perform reverse_entry(
      v_entry.id,
      case when v_locked is not null and v_entry.entry_date <= v_locked then current_date else v_entry.entry_date end,
      'Reversal of ' || coalesce(v_entry.memo, 'imported transaction')
    );
    v_n := v_n + 1;
  end loop;

  select count(*)::int into v_left
  from journal_entries e
  where e.import_batch_id = p_batch_id
    and e.reverses_entry_id is null
    and not exists (select 1 from journal_entries r where r.reverses_entry_id = e.id);

  if v_left = 0 then
    delete from statement_lines where batch_id = p_batch_id;
    update import_batches set undone_at = now() where id = p_batch_id;
  end if;
  return query select v_n, v_left, v_left = 0;
end $$;
