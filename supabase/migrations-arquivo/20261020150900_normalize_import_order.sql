-- Keep imported maps editable even when a valid backup uses very high sort indices.
begin;
create or replace function private.import_map_backup(p_operation_id uuid,p_editor_session_id uuid,p_backup jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid:=auth.uid();
  scopes uuid[];
  destination public.maps;
  previous public.map_operations;
  hash text;
  exported timestamptz;
  normalized jsonb;
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  if p_operation_id is null or p_editor_session_id is null or jsonb_typeof(p_backup) is distinct from 'object' then
    raise exception using message='VALIDATION'; end if;
  if octet_length(p_backup::text)>2097152 then raise exception using message='LIMIT_EXCEEDED'; end if;
  if (select count(*) from jsonb_object_keys(p_backup))<>6
    or not p_backup ?& array['format','version','exportedAt','hasPendingChanges','map','nodes']
    or p_backup->>'format' is distinct from 'mapa-mental' or p_backup->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_backup->'exportedAt') is distinct from 'string'
    or jsonb_typeof(p_backup->'hasPendingChanges') is distinct from 'boolean'
    or jsonb_typeof(p_backup->'map') is distinct from 'object' then raise exception using message='VALIDATION'; end if;
  if (select count(*) from jsonb_object_keys(p_backup->'map'))<>1
    or jsonb_typeof(p_backup#>'{map,title}') is distinct from 'string'
    or char_length(p_backup#>>'{map,title}') not between 1 and 120
    or (p_backup#>>'{map,title}') !~ '[^[:space:]]' then raise exception using message='VALIDATION'; end if;
  if (p_backup->>'exportedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then raise exception using message='VALIDATION'; end if;
  begin exported:=(p_backup->>'exportedAt')::timestamptz;
    exception when others then raise exception using message='VALIDATION'; end;
  perform private.validate_copy_nodes(p_backup->'nodes');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  -- The file and API cannot choose a workspace or owner. UI supports one active membership.
  select array_agg(m.workspace_id) into scopes from public.workspace_members m where m.user_id=actor and m.status='active';
  if coalesce(cardinality(scopes),0)<>1 then raise exception using message='FORBIDDEN'; end if;
  perform 1 from public.workspace_members m where m.user_id=actor and m.workspace_id=scopes[1] and m.status='active' for share;
  if not found then raise exception using message='FORBIDDEN'; end if;
  destination.workspace_id:=scopes[1];
  hash:=md5(jsonb_build_object('kind','import_map','workspaceId',destination.workspace_id,'backup',p_backup)::text);
  select * into previous from public.map_operations where id=p_operation_id;
  if found then
    if previous.actor_id<>actor or previous.editor_session_id<>p_editor_session_id or previous.request_hash<>hash then
      raise exception using message='CONFLICT'; end if;
    return previous.after_data;
  end if;
  -- Preserve sibling order while preventing imported sparse/max-int indices from
  -- overflowing a later add_child (which appends max(sort_order)+1).
  select jsonb_agg(r.value||jsonb_build_object('sortOrder',r.sibling_order) order by r.ordinality) into normalized
  from (select value,ordinality,
    (row_number() over(partition by (value->>'parentId')::uuid order by (value->>'sortOrder')::integer,(value->>'id')::uuid)-1)::integer as sibling_order
    from jsonb_array_elements(p_backup->'nodes') with ordinality) r;
  return private.insert_map_copy(destination,p_operation_id,p_editor_session_id,p_backup#>>'{map,title}',normalized,hash,'import_map');
end;
$$;
commit;
