-- Ticket 05. Maps, nodes and the trusted operation log. Clients read through RLS
-- and write only through finite RPCs; authorship always comes from auth.uid().
begin;

create table public.maps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120 and btrim(title) <> ''),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  revision bigint not null default 1 check (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Library listing reads only this index-backed row set, never node payloads.
create index maps_workspace_library_idx on public.maps(workspace_id, updated_at desc) where deleted_at is null;

create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  -- Hard deletes of maps are administrative only (product uses deleted_at).
  map_id uuid not null references public.maps(id) on delete cascade,
  parent_id uuid,
  text text not null check (char_length(text) between 1 and 500 and btrim(text) <> ''),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  source text not null default 'manual' check (source in ('manual', 'ai')),
  ai_generation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (map_id, id),
  -- A parent always belongs to the same map.
  foreign key (map_id, parent_id) references public.nodes(map_id, id),
  check (parent_id is null or parent_id <> id)
);
create unique index nodes_one_root_per_map on public.nodes(map_id) where parent_id is null;
create index nodes_children_idx on public.nodes(map_id, parent_id, sort_order);

create table public.map_operations (
  id uuid primary key,
  map_id uuid not null references public.maps(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  editor_session_id uuid not null,
  kind text not null check (char_length(kind) between 1 and 40),
  base_revision bigint,
  result_revision bigint not null,
  request_hash text not null,
  before_data jsonb,
  after_data jsonb not null,
  undone_operation_id uuid references public.map_operations(id),
  created_at timestamptz not null default now()
);
create index map_operations_map_idx on public.map_operations(map_id, created_at);

alter table public.maps enable row level security;
alter table public.nodes enable row level security;
alter table public.map_operations enable row level security;
revoke all on table public.maps, public.nodes, public.map_operations from public, anon, authenticated;
grant select on table public.maps, public.nodes to authenticated;
-- The operation log has no client grants or policies at all.
grant all on table public.maps, public.nodes, public.map_operations to service_role;

create function private.can_read_map(target_map_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.maps m
    join public.workspace_members wm on wm.workspace_id = m.workspace_id
    where m.id = target_map_id and m.deleted_at is null and wm.user_id = auth.uid() and wm.status = 'active'
  );
$$;
revoke all on function private.can_read_map(uuid) from public, anon, authenticated;
grant execute on function private.can_read_map(uuid) to authenticated;

create policy map_read on public.maps for select to authenticated
  using (deleted_at is null and private.is_active_member(workspace_id));
create policy node_read on public.nodes for select to authenticated
  using (private.can_read_map(map_id));

-- Every map keeps exactly one root at commit (unique index covers "at most one").
create function private.assert_map_has_root()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare target uuid;
begin
  if tg_table_name = 'maps' then target := new.id; else target := old.map_id; end if;
  if exists (select 1 from public.maps where id = target)
     and not exists (select 1 from public.nodes where map_id = target and parent_id is null) then
    raise exception using message = 'VALIDATION', detail = 'Map without root node.';
  end if;
  return null;
end;
$$;
revoke all on function private.assert_map_has_root() from public, anon, authenticated;
create constraint trigger maps_require_root after insert on public.maps
  deferrable initially deferred for each row execute function private.assert_map_has_root();
create constraint trigger nodes_keep_root after delete or update of parent_id, map_id on public.nodes
  deferrable initially deferred for each row execute function private.assert_map_has_root();

-- Idempotent creation: same operation id + same request returns the first result;
-- the same id with different content or another actor is a conflict.
create function private.create_map(p_workspace_id uuid, p_operation_id uuid, p_editor_session_id uuid, p_title text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_title text := coalesce(p_title, 'Novo mapa');
  hash text;
  previous public.map_operations;
  new_map_id uuid;
  root public.nodes;
begin
  if actor is null then raise exception using message = 'UNAUTHENTICATED'; end if;
  if p_workspace_id is null or p_operation_id is null or p_editor_session_id is null then
    raise exception using message = 'VALIDATION';
  end if;
  if not private.is_active_member(p_workspace_id) then raise exception using message = 'FORBIDDEN'; end if;
  if char_length(v_title) not between 1 and 120 or btrim(v_title) = '' then raise exception using message = 'VALIDATION'; end if;
  hash := md5(jsonb_build_object('kind', 'create_map', 'workspace_id', p_workspace_id, 'title', v_title)::text);

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into previous from public.map_operations where id = p_operation_id;
  if found then
    if previous.actor_id <> actor or previous.request_hash <> hash then raise exception using message = 'CONFLICT'; end if;
    return jsonb_build_object('operationId', previous.id, 'mapId', previous.map_id, 'revision', previous.result_revision);
  end if;

  insert into public.maps (workspace_id, title, owner_id, created_by, updated_by)
  values (p_workspace_id, v_title, actor, actor, actor) returning id into new_map_id;
  insert into public.nodes (map_id, parent_id, text, sort_order, created_by, updated_by)
  values (new_map_id, null, 'Ideia central', 0, actor, actor) returning * into root;
  insert into public.map_operations (id, map_id, workspace_id, actor_id, editor_session_id, kind, base_revision, result_revision, request_hash, after_data)
  values (p_operation_id, new_map_id, p_workspace_id, actor, p_editor_session_id, 'create_map', null, 1, hash,
    jsonb_build_object('mapId', new_map_id, 'title', v_title, 'ownerId', actor, 'rootNodeId', root.id));
  return jsonb_build_object('operationId', p_operation_id, 'mapId', new_map_id, 'revision', 1);
end;
$$;
revoke all on function private.create_map(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.create_map(uuid, uuid, uuid, text) to authenticated;

-- Public entry points: SECURITY INVOKER, finite signatures.
create function public.create_map(p_workspace_id uuid, p_operation_id uuid, p_editor_session_id uuid, p_title text default null)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.create_map(p_workspace_id, p_operation_id, p_editor_session_id, p_title); $$;

-- One statement, one snapshot: map and nodes always share the same revision.
-- An inaccessible or nonexistent map both return null.
create function public.get_map_document(p_map_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'map', jsonb_build_object('id', m.id, 'workspaceId', m.workspace_id, 'title', m.title, 'ownerId', m.owner_id,
      'ownerName', p.display_name, 'revision', m.revision, 'createdAt', m.created_at, 'updatedAt', m.updated_at),
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'parentId', n.parent_id, 'text', n.text, 'sortOrder', n.sort_order,
        'createdBy', n.created_by, 'updatedBy', n.updated_by, 'source', n.source) order by n.sort_order, n.created_at)
      from public.nodes n where n.map_id = m.id), '[]'::jsonb))
  from public.maps m left join public.profiles p on p.id = m.owner_id
  where m.id = p_map_id and m.deleted_at is null;
$$;

revoke all on function public.create_map(uuid, uuid, uuid, text), public.get_map_document(uuid) from public, anon, authenticated;
grant execute on function public.create_map(uuid, uuid, uuid, text), public.get_map_document(uuid) to authenticated;
commit;
