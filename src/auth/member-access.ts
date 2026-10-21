import { z } from 'zod';
import type { ActionFunctionArgs } from 'react-router';
import { supabase } from '../lib/supabase';
import { requireMember } from './access';
import { manageInvitationAction } from './invitations';
export const memberAccessResult=z.object({status:z.enum(['active','inactive']).optional(),error:z.string().optional(),maps:z.array(z.object({id:z.uuid(),title:z.string()}))});
export type TeamActionResult={error?:string;message?:string;maps?:{id:string;title:string}[]};
export const memberAccessErrors:Record<string,string>={
 FORBIDDEN:'Somente um administrador ativo pode alterar o acesso da equipe.',
 LAST_ADMIN:'O último administrador ativo não pode ser desativado.',
 OWNED_MAPS:'Transfira a responsabilidade dos mapas abaixo antes de desativar esta pessoa.',
 ALREADY_MEMBER:'Esta pessoa já possui acesso ativo a outra equipe.',
 NOT_FOUND:'Esta pessoa não pertence à equipe.',VALIDATION:'Confira a pessoa e a ação solicitada.',
 UNAUTHENTICATED:'Sua sessão expirou. Entre novamente.',UNAVAILABLE:'Não foi possível atualizar o acesso. Confira sua conexão e tente novamente.',
};
export async function manageMemberAccess(args:ActionFunctionArgs):Promise<TeamActionResult> {
 const access=await requireMember(args);
 if(access.role!=='admin')return {error:memberAccessErrors.FORBIDDEN};
 const form=await args.request.formData();const user=String(form.get('userId')??''),intent=String(form.get('intent')??'');
 if(!supabase||!z.uuid().safeParse(user).success||!['deactivate','reactivate'].includes(intent))return {error:memberAccessErrors.VALIDATION};
 try{
  const {data,error}=await supabase.rpc('set_member_access',{p_workspace:access.workspace.id,p_user:user,p_status:intent==='deactivate'?'inactive':'active'});
  if(error)return {error:memberAccessErrors[error.message]??memberAccessErrors.UNAVAILABLE};
  const result=memberAccessResult.parse(data);
  if(result.error)return {error:memberAccessErrors[result.error]??memberAccessErrors.UNAVAILABLE,maps:result.maps};
  return {message:result.status==='inactive'?'Acesso desativado. Autoria e histórico foram preservados.':'Acesso reativado. O papel da pessoa foi preservado.'};
 }catch{return {error:memberAccessErrors.UNAVAILABLE};}
}
export async function teamAction(args:ActionFunctionArgs):Promise<TeamActionResult|Response> {
 const intent=(await args.request.clone().formData()).get('intent');
 return intent==='deactivate'||intent==='reactivate'?manageMemberAccess(args):manageInvitationAction(args);
}
