import { useEffect, useState } from 'react';
import { Form, Link, useActionData, useLoaderData, useNavigation } from 'react-router';
import { Page } from './pages';
import type { teamLoader } from '../auth/team-loader';
import type { PendingInvitation, Invitation, acceptInvitationAction } from '../auth/invitations';
import type { teamAction } from '../auth/member-access';
import { MemberAccessControl } from './member-access';
const date=(value:string)=>new Date(value).toLocaleString('pt-BR');
function InvitationRow({invitation,now,busy}:{invitation:Invitation;now:number;busy:boolean}) {
 const expired=new Date(invitation.expires_at).getTime()<=now;
 const remaining=Math.max(0,Math.ceil(((invitation.last_attempt_at?new Date(invitation.last_attempt_at).getTime():0)+60_000-now)/1000));
 const label=invitation.status==='accepted'?'Aceito':invitation.status==='revoked'?'Revogado':expired?'Vencido':invitation.delivery_state==='existing'?'Conta existente · aguardando aceite':invitation.delivery_state==='sent'?'Envio confirmado · aguardando aceite':invitation.delivery_state==='failed'?'Falha no envio':'Envio ainda não confirmado';
 return <li className="invitation-row"><div><strong>{invitation.email}</strong><p>{label}</p><p>Validade: {date(invitation.expires_at)}</p></div>
  {invitation.status==='pending'&&<div className="invitation-actions">
   <Form method="post"><input type="hidden" name="invitationId" value={invitation.id}/><button className="button button-secondary" name="intent" value="retry" disabled={busy||remaining>0}>{remaining>0?`Reenviar em ${remaining}s`:invitation.delivery_state==='existing'?'Renovar convite':'Reenviar convite'}</button></Form>
   <Form method="post"><input type="hidden" name="invitationId" value={invitation.id}/><button className="button button-secondary" name="intent" value="revoke" disabled={busy}>Revogar convite</button></Form>
  </div>}
 </li>;
}
export function TeamPage() {
 const {access,members,invitations}=useLoaderData<typeof teamLoader>();
 const result=useActionData<typeof teamAction>();
 const busy=useNavigation().state!=='idle';
 const [id,setId]=useState(()=>crypto.randomUUID());
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 return <Page title="Sua equipe" eyebrow="Pessoas"><div className="access-panel"><span className="section-number">{access.workspace.name}</span><h2>Pessoas da equipe</h2>
  <ul className="team-list">{members.map(member=><li key={member.user_id}><strong>{member.name}{member.user_id===access.userId?' (você)':''}</strong><span>{member.role==='admin'?'Administrador':'Membro'} · {member.status==='active'?'Ativo':'Inativo'}</span>{access.role==='admin'&&<MemberAccessControl userId={member.user_id} name={member.name} status={member.status} busy={busy}/>}</li>)}</ul>
  {result?.error&&<p className="form-error" role="alert">{result.error}</p>}{result?.message&&<p role="status">{result.message}</p>}
  {result?.maps&&result.maps.length>0&&<ul className="blocking-maps" aria-label="Mapas que precisam ser transferidos">{result.maps.map(map=><li key={map.id}><Link className="text-link" to={`/mapas/${map.id}`}>{map.title} — abrir para transferir</Link></li>)}</ul>}
  {access.role==='admin'&&<><h2>Convidar pessoa</h2><p>O convite vale por sete dias. A pessoa entra como membro depois de aceitar.</p>
   <Form method="post" className="login-form" onChange={()=>setId(crypto.randomUUID())}><input type="hidden" name="intent" value="create"/><input type="hidden" name="invitationId" value={id}/>
    <div><label htmlFor="invite-email">E-mail da pessoa</label><input id="invite-email" name="email" type="email" autoComplete="email" autoCapitalize="none" maxLength={254} required/></div>
    <button className="button" disabled={busy}>Enviar convite</button>
   </Form>
   <h2>Convites da equipe</h2><p>Uma conta já existente pode entrar com sua senha e aceitar em Sem acesso. Reenvios ficam disponíveis após 60 segundos.</p>
   {invitations.length?<ul className="invitation-list">{invitations.map(invitation=><InvitationRow key={invitation.id} invitation={invitation} now={now} busy={busy}/>)}</ul>:<p>Nenhum convite registrado.</p>}
  </>}
 </div></Page>;
}
export function NoAccessPage() {
 const {invitations}=useLoaderData<{invitations:PendingInvitation[]}>();
 const result=useActionData<typeof acceptInvitationAction>();
 const busy=useNavigation().state!=='idle';
 return <Page title="Sem acesso à equipe" eyebrow="Acesso restrito"><div className="access-panel"><h2>Sua conta não tem vínculo ativo</h2>
  {result?.error&&<p role="alert" className="form-error">{result.error}</p>}
  {invitations.length?<><p>Você tem convites para o e-mail confirmado desta conta. Aceite um para entrar na equipe.</p><ul className="invitation-list">{invitations.map(invitation=><li key={invitation.id} className="invitation-row"><div><strong>{invitation.workspace_name}</strong><p>{invitation.email}</p><p>Válido até {date(invitation.expires_at)}</p></div><Form method="post"><input type="hidden" name="invitationId" value={invitation.id}/><button className="button" disabled={busy}>Aceitar convite</button></Form></li>)}</ul></>:<p>Solicite acesso ao administrador da equipe ou saia para entrar com outra conta.</p>}
 </div></Page>;
}
