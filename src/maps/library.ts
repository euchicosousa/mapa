import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { MapError,toMapError } from './api';

export type LibraryFilters={query:string;project:string;owner:string;page:number};
const uuid=z.uuid();
export function parseLibraryFilters(params:URLSearchParams):LibraryFilters {
  const project=params.get('project')??'',owner=params.get('owner')??'',number=Number(params.get('page')??1);
  return {query:params.get('q')??'',project:project==='none'||uuid.safeParse(project).success?project:'',owner:uuid.safeParse(owner).success?owner:'',page:Number.isSafeInteger(number)&&number>=1&&number<=2147483647?number:1};
}
export function librarySearch(filters:LibraryFilters) {
  const params=new URLSearchParams();
  if(filters.query)params.set('q',filters.query);
  if(filters.project)params.set('project',filters.project);
  if(filters.owner)params.set('owner',filters.owner);
  if(filters.page>1)params.set('page',String(filters.page));
  return params;
}
const summary=z.object({id:z.uuid(),title:z.string(),projectId:z.uuid().nullable(),projectName:z.string().nullable(),clientName:z.string().nullable(),ownerId:z.uuid(),ownerName:z.string(),updatedAt:z.string(),revision:z.number().int().positive()});
const page=z.object({items:z.array(summary).max(20),total:z.number().int().nonnegative(),unfilteredTotal:z.number().int().nonnegative(),page:z.number().int().positive(),pageSize:z.literal(20),totalPages:z.number().int().positive()});
export type LibraryPageData=z.infer<typeof page>;
export type MapSummary=z.infer<typeof summary>;
export const projectSchema=z.object({id:z.uuid(),name:z.string(),clientName:z.string().nullable()});
export type Project=z.infer<typeof projectSchema>;
function client(){if(!supabase)throw new MapError('UNAVAILABLE');return supabase;}
export async function listLibrary(workspaceId:string,filters:LibraryFilters,signal:AbortSignal):Promise<LibraryPageData>{
  const {data,error}=await client().rpc('list_map_library',{p_workspace_id:workspaceId,p_query:filters.query,p_project_id:filters.project&&filters.project!=='none'?filters.project:undefined,p_without_project:filters.project==='none',p_owner_id:filters.owner||undefined,p_page:filters.page}).abortSignal(signal);
  if(error)throw toMapError(error);return page.parse(data);
}
export async function listProjects(workspaceId:string,signal:AbortSignal):Promise<Project[]>{
  const {data,error}=await client().from('projects').select('id,name,client_name').eq('workspace_id',workspaceId).order('name').order('id').abortSignal(signal);
  if(error)throw toMapError(error);return data.map(row=>projectSchema.parse({id:row.id,name:row.name,clientName:row.client_name}));
}
export async function listOwners(workspaceId:string,signal:AbortSignal){
  const {data,error}=await client().from('workspace_members').select('user_id,status,profile:profiles!workspace_members_user_id_fkey(display_name)').eq('workspace_id',workspaceId).abortSignal(signal);
  if(error)throw toMapError(error);return data.map(row=>({id:row.user_id,name:row.profile?.display_name??'Membro da equipe',active:row.status==='active'})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
export type ProjectRequest={id:string;name:string;clientName:string|null};
export async function saveProject(workspaceId:string,request:ProjectRequest,creating:boolean):Promise<Project>{
  const result=creating?await client().rpc('create_project',{p_workspace_id:workspaceId,p_project_id:request.id,p_name:request.name,p_client_name:request.clientName??undefined}).abortSignal(AbortSignal.timeout(20_000))
    :await client().rpc('rename_project',{p_project_id:request.id,p_name:request.name,p_client_name:request.clientName??undefined}).abortSignal(AbortSignal.timeout(20_000));
  if(result.error)throw toMapError(result.error);return projectSchema.parse(result.data);
}
