-- Who owns what.
--
--  * A portfolio can name a default owner: new properties added to it start with that entity.
--  * A property can have several owners, each with a percentage (in basis points: 6000 = 60%).
--    properties.entity_id stays the owner that keeps the property's books; it is always one of the owners.

alter table portfolios
  add column default_entity_id uuid,
  add foreign key (default_entity_id, workspace_id) references entities (id, workspace_id);

create table property_owners (
  property_id uuid not null,
  entity_id uuid not null,
  workspace_id uuid not null,
  percent_bp integer not null check (percent_bp > 0 and percent_bp <= 10000),
  primary key (property_id, entity_id),
  foreign key (property_id, workspace_id) references properties (id, workspace_id) on delete cascade,
  foreign key (entity_id, workspace_id) references entities (id, workspace_id)
);
create index on property_owners (entity_id);

alter table property_owners enable row level security;
create policy property_owners_select on property_owners for select using (is_workspace_member(workspace_id));
create policy property_owners_insert on property_owners for insert with check (is_workspace_member(workspace_id));
create policy property_owners_update on property_owners for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy property_owners_delete on property_owners for delete using (is_workspace_member(workspace_id));

-- Every property starts with its entity as the sole owner, including the ones that already exist.
insert into property_owners (property_id, entity_id, workspace_id, percent_bp)
select id, entity_id, workspace_id, 10000 from properties;

create or replace function property_starts_with_owner() returns trigger
language plpgsql
as $$
begin
  insert into property_owners (property_id, entity_id, workspace_id, percent_bp)
  values (new.id, new.entity_id, new.workspace_id, 10000);
  return new;
end $$;
create trigger properties_start_with_owner after insert on properties for each row execute function property_starts_with_owner();

-- Replace a property's owners in one step. The percentages must add up to 100%, and the entity that keeps the
-- books must be one of the owners. The books-keeper can only change while the property has no transactions,
-- because a transaction lives in one entity's books.
create or replace function set_property_owners(p_property_id uuid, p_primary uuid, p_owners jsonb)
returns void
language plpgsql
as $$
declare
  v_prop properties%rowtype;
  v_total integer;
  v_count integer;
  v_distinct integer;
begin
  select * into v_prop from properties where id = p_property_id for update;
  if not found then
    raise exception 'Property not found';
  end if;

  select count(*), count(distinct (o ->> 'entity_id')), coalesce(sum((o ->> 'percent_bp')::integer), 0)
    into v_count, v_distinct, v_total
  from jsonb_array_elements(p_owners) o;
  if v_count = 0 then
    raise exception 'A property needs at least one owner';
  end if;
  if v_count <> v_distinct then
    raise exception 'Each owner can be listed only once';
  end if;
  if exists (select 1 from jsonb_array_elements(p_owners) o where (o ->> 'percent_bp')::integer <= 0) then
    raise exception 'Each owner needs a percentage above zero';
  end if;
  if v_total <> 10000 then
    raise exception 'The percentages add up to % percent, but must add up to 100 percent', to_char(v_total / 100.0, 'FM990.00');
  end if;
  if not exists (select 1 from jsonb_array_elements(p_owners) o where (o ->> 'entity_id')::uuid = p_primary) then
    raise exception 'The owner that keeps the books must be one of the owners';
  end if;

  if p_primary <> v_prop.entity_id then
    if exists (select 1 from journal_lines where property_id = p_property_id and entity_id = v_prop.entity_id)
       or exists (select 1 from statement_lines where property_id = p_property_id and entity_id = v_prop.entity_id)
       or exists (select 1 from accounts where property_id = p_property_id and entity_id = v_prop.entity_id) then
      raise exception 'This property already has transactions or accounts in its current owner''s books, so the owner that keeps the books cannot change';
    end if;
    update properties set entity_id = p_primary where id = p_property_id;
  end if;

  delete from property_owners where property_id = p_property_id;
  insert into property_owners (property_id, entity_id, workspace_id, percent_bp)
  select p_property_id, (o ->> 'entity_id')::uuid, v_prop.workspace_id, (o ->> 'percent_bp')::integer
  from jsonb_array_elements(p_owners) o;
end $$;
