begin;
grant usage on schema private to service_role;
-- Preserve the established manual-node payload. AI provenance is included only
-- when present, including snapshots needed to restore deleted AI branches.
create or replace function private.node_json(n public.nodes) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',n.id,'parentId',n.parent_id,'text',n.text,'sortOrder',n.sort_order,'createdBy',n.created_by,
 'updatedBy',n.updated_by,'source',n.source)||case when n.ai_generation_id is null then '{}'::jsonb else jsonb_build_object('aiGenerationId',n.ai_generation_id) end;
$$;
commit;
