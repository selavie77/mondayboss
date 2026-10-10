-- Yearly income / expense by property for the Monday dashboard.
-- Small result set (one row per property per year) so the API row cap is never hit.
create view property_summary_yearly with (security_invoker = true) as
select
  l.workspace_id,
  l.entity_id,
  l.property_id,
  extract(year from e.entry_date)::int as year,
  coalesce(sum(l.credit_cents - l.debit_cents) filter (where a.type = 'income'), 0)::bigint as income_cents,
  coalesce(sum(l.debit_cents - l.credit_cents) filter (where a.type = 'expense'), 0)::bigint as expense_cents
from journal_lines l
join journal_entries e on e.id = l.entry_id
join accounts a on a.id = l.account_id
where a.type in ('income', 'expense')
group by l.workspace_id, l.entity_id, l.property_id, extract(year from e.entry_date);
