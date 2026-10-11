-- A general "Transfers" account for money moved between you and the business, or between accounts,
-- that is not income or an expense and has no more specific category. Created the first time it is needed.
create or replace function ensure_transfers_account(p_entity_id uuid) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_workspace uuid;
  v_desc constant text := 'Money moved between you and the business, or between accounts, that is not income or an expense. Use a more specific transfer category (like owner distributions) when you can.';
begin
  select id into v_id from accounts where entity_id = p_entity_id and subtype = 'transfers' limit 1;
  if found then
    return v_id;
  end if;

  select workspace_id into v_workspace from entities where id = p_entity_id;
  begin
    insert into accounts (workspace_id, entity_id, code, name, type, subtype, description)
    values (v_workspace, p_entity_id, '3200', 'Transfers', 'equity', 'transfers', v_desc)
    returning id into v_id;
  exception when unique_violation then
    v_id := create_account(p_entity_id, null, 'equity', 'Transfers (system)', null, v_desc);
    update accounts set subtype = 'transfers' where id = v_id;
  end;
  return v_id;
end $$;
