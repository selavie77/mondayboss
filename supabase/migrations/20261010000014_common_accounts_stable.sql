-- Ties in usage are broken by account code, so the quick picks stay in a stable, predictable order.
create or replace function common_accounts(p_entity_id uuid, p_type account_type, p_limit integer default 6)
returns table (account_id uuid, uses bigint)
language sql
stable
as $$
  select l.account_id, count(*)::bigint as uses
  from journal_lines l
  join accounts a on a.id = l.account_id
  join journal_entries e on e.id = l.entry_id
  where l.entity_id = p_entity_id
    and a.type = p_type
    and e.source not in ('system', 'reversal')
  group by l.account_id, a.code
  order by uses desc, a.code, l.account_id
  limit p_limit
$$;
