-- Remembers how a business matched things in an imported file (a Stessa property, bank account or category)
-- to its own properties and accounts, so the next import pre-selects the same choices.
create table import_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entity_id uuid not null,
  kind text not null check (kind in ('portfolio', 'property', 'source', 'category')),
  stessa_key text not null check (char_length(stessa_key) <= 500),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (entity_id, kind, stessa_key),
  foreign key (entity_id, workspace_id) references entities (id, workspace_id)
);

alter table import_mappings enable row level security;
create policy import_mappings_select on import_mappings for select using (is_workspace_member(workspace_id));
create policy import_mappings_insert on import_mappings for insert with check (is_workspace_member(workspace_id));
create policy import_mappings_update on import_mappings for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy import_mappings_delete on import_mappings for delete using (is_workspace_member(workspace_id));
