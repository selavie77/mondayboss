-- Let the report query group by business (entity), so each business can be shown side by side with a total.
--   p_group = 'entity' -> one bucket per entity (the bucket is the entity's id), all properties combined
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
      when 'entity' then l.entity_id::text
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
