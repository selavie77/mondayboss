-- Show co-owned properties at each owner's share, in reports only.
--
-- Transactions stay exactly as recorded, in the books of the owner that keeps them. With p_allocate on, every line
-- tagged to a property is attributed to that property's owners by their percentages (property_owners), so:
--   * a business's report holds its share of each property it owns, plus whatever else is in its own books,
--   * "by business" columns show each owner's share,
--   * all businesses combined add up to exactly the whole, because shares always total 100%.
-- Each line is split in whole cents; the owner that keeps the books takes any odd cent, so nothing is lost.
-- With p_allocate off, a line belongs to the entity whose books it is in, as before.
drop function if exists report_activity(date, date, text, uuid[], uuid[]);

create or replace function report_activity(
  p_from date,
  p_to date,
  p_group text default 'property',
  p_property_ids uuid[] default null,
  p_entity_ids uuid[] default null,
  p_allocate boolean default false
) returns table (bucket text, property_id uuid, account_id uuid, net_cents bigint)
language sql
stable
as $$
  with lines as (
    select l.id as line_id, e.entry_date, l.account_id, l.property_id, l.entity_id as journal_entity,
           l.debit_cents - l.credit_cents as net, p.entity_id as primary_entity
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    left join properties p on p.id = l.property_id
    where e.entry_date between p_from and p_to
      and (p_property_ids is null or l.property_id = any (p_property_ids))
  ),
  split as (
    -- A property's lines: one row for each owner, with that owner's share.
    select ln.entry_date, ln.account_id, ln.property_id, o.entity_id as attributed_to,
           (case when o.entity_id = ln.primary_entity
                 then ln.net - coalesce(sum(case when o.entity_id <> ln.primary_entity then round(ln.net * o.percent_bp / 10000.0) end)
                                         over (partition by ln.line_id), 0)
                 else round(ln.net * o.percent_bp / 10000.0)
            end)::bigint as net
    from lines ln
    join property_owners o on o.property_id = ln.property_id
    where p_allocate
    union all
    -- Everything else stays whole, with the entity whose books it is in.
    select ln.entry_date, ln.account_id, ln.property_id, ln.journal_entity, ln.net
    from lines ln
    where not p_allocate
       or ln.property_id is null
       or not exists (select 1 from property_owners o where o.property_id = ln.property_id)
  )
  select
    case p_group
      when 'month' then to_char(s.entry_date, 'YYYY-MM')
      when 'quarter' then to_char(s.entry_date, 'YYYY') || '-Q' || to_char(s.entry_date, 'Q')
      when 'year' then to_char(s.entry_date, 'YYYY')
      when 'entity' then s.attributed_to::text
      else 'all'
    end as bucket,
    case when p_group = 'property' then s.property_id end as property_id,
    s.account_id,
    sum(s.net)::bigint as net_cents
  from split s
  where p_entity_ids is null or s.attributed_to = any (p_entity_ids)
  group by 1, 2, 3
  order by 1, 2, 3
$$;
