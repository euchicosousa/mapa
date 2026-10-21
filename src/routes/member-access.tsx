import { useState } from 'react';
import { Form } from 'react-router';
import { DraftDialog } from './draft-dialog';
export function MemberAccessControl({userId,name,status,busy}:{userId:string;name:string;status:string;busy:boolean}) {
 const [open,setOpen]=useState(false);
 return <><button className="button button-secondary" type="button" disabled={busy} onClick={()=>setOpen(true)}>{status==='active'?'Desativar acesso':'Reativar acesso'}</button>
 <DraftDialog open={open} onClose={()=>setOpen(false)} busy={busy} closeLabel="Cancelar" title={status==='active'?`Desativar acesso de ${name}?`:`Reativar acesso de ${name}?`} description={status==='active'?'A pessoa perderá o acesso à equipe. Autoria e histórico serão preservados. Se houver mapas sob sua responsabilidade, será preciso transferi-los antes.':'A pessoa voltará a acessar a equipe com o mesmo papel. Autoria e histórico continuam preservados.'}>
  <Form method="post" onSubmit={()=>setOpen(false)}><input type="hidden" name="userId" value={userId}/><button className="button" name="intent" value={status==='active'?'deactivate':'reactivate'} disabled={busy}>{status==='active'?'Confirmar desativação':'Confirmar reativação'}</button></Form>
 </DraftDialog></>;
}
