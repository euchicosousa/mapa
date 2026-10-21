import { z } from 'zod';
import { redirect, type ActionFunctionArgs } from 'react-router';
import { supabase } from '../lib/supabase';
import { requireMember } from './access';
export const invitationSchema=z.object({id:z.uuid(),email:z.string(),status:z.enum(['pending','accepted','revoked']),expires_at:z.string(),last_attempt_at:z.string().nullable(),delivery_state:z.enum(['sending','sent','existing','failed'])});
export type Invitation=z.infer<typeof invitationSchema>;
export const pendingInvitationSchema=z.object({id:z.uuid(),workspace_name:z.string(),email:z.string(),expires_at:z.string()});
export type PendingInvitation=z.infer<typeof pendingInvitationSchema>;
export const invitationErrors:Record<string,string>={
 FORBIDDEN:'Somente um administrador ativo pode gerenciar convites.',
 VALIDATION:'Confira o e-mail e tente novamente.',
 NOT_FOUND:'Este convite não está disponível.',CONFLICT:'O convite mudou. Atualize a página e tente novamente.',
 INVITE_CLOSED:'Este convite já foi aceito ou revogado.',COOLDOWN:'Aguarde 60 segundos após a última tentativa antes de reenviar.',
 ALREADY_MEMBER:'Esta conta já possui vínculo ativo com uma equipe.',
 SEND_FAILED:'Não foi possível enviar o e-mail. O convite ficou registrado e você pode tentar reenviar após 60 segundos.',
 DELIVERY_UNKNOWN:'O envio ainda não foi confirmado. Confira o estado do convite antes de tentar reenviar após 60 segundos.',
 UNAUTHENTICATED:'Sua sessão expirou. Entre novamente.',UNAVAILABLE:'O serviço de convites está indisponível. Confira sua conexão e tente novamente.',
 INVITE_UNAVAILABLE:'Este convite expirou, foi revogado ou não corresponde ao e-mail confirmado da sua conta. Peça um novo convite ao administrador.',
};
export async function manageInvitationAction(args:ActionFunctionArgs) {
 const access=await requireMember(args);
 if(access.role!=='admin')return {error:invitationErrors.FORBIDDEN};
 if(!supabase)return {error:invitationErrors.UNAVAILABLE};
 const form=await args.request.formData();
 const action=String(form.get('intent')??'');
 const email=String(form.get('email')??'').trim().toLowerCase();
 const id=String(form.get('invitationId')??'');
 if(!['create','retry','revoke'].includes(action)||!z.uuid().safeParse(id).success||(action==='create'&&!z.email().max(254).safeParse(email).success))return {error:invitationErrors.VALIDATION};
 try {
  const {data,error}=await supabase.functions.invoke('manage-invitation',{body:{action,workspaceId:access.workspace.id,invitationId:id,...(action==='create'?{email}:{}),redirectTo:new URL('/auth/callback',args.request.url).href}});
  if(error){let code='UNAVAILABLE';try{if(error.context instanceof Response)code=(await error.context.json()).error??code;}catch{/* Never expose raw function errors. */}return {error:invitationErrors[code]??invitationErrors.UNAVAILABLE};}
  return {message:action==='revoke'?'Convite revogado. O link não concede acesso à equipe.':data?.deliveryState==='existing'?'A conta já existe. A pessoa pode entrar com sua senha e aceitar o convite em Sem acesso.':data?.attempted===false?'Este convite já está registrado. Confira a validade na lista e use Reenviar convite se precisar de um novo envio.':data?.deliveryState==='sent'?'Convite com envio confirmado. A pessoa precisa definir a senha e aceitar entrar na equipe. Peça para conferir também a pasta de spam.':'O convite está registrado; confira o estado do envio na lista.'};
 }catch{return {error:invitationErrors.UNAVAILABLE};}
}
export async function acceptInvitationAction({request}:ActionFunctionArgs) {
 const id=(await request.formData()).get('invitationId');
 if(!supabase||!z.uuid().safeParse(id).success)return {error:invitationErrors.INVITE_UNAVAILABLE};
 try {
  const {error}=await supabase.rpc('accept_workspace_invitation',{p_id:String(id)});
  if(error)return {error:invitationErrors[error.message]??invitationErrors.UNAVAILABLE};
  return redirect('/mapas');
 }catch{return {error:invitationErrors.UNAVAILABLE};}
}
