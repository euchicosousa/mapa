import { z } from 'zod';
import { redirect, type ActionFunctionArgs } from 'react-router';
import { supabase } from '../lib/supabase';
import { beginAuthAction } from './transitions';
import { lockPrivateData, unlockPrivateData } from './privacy';
import { readAccess } from './access';
import { clearAccountDrafts } from '../maps/drafts';
import { useEditorStore } from '../state/editor';
import { hasPendingEdits } from '../state/editor-lifecycle';
import { safeReturnTo } from './return-to';

const credentials = z.object({ email: z.email().max(254), password: z.string().min(1).max(1024) });
export async function loginAction({ request }: ActionFunctionArgs) {
  if (!supabase) return { error: 'Configure o acesso antes de entrar.' };
  const form = await request.formData();
  const parsed = credentials.safeParse({ email: String(form.get('email') ?? '').trim(), password: form.get('password') });
  if (!parsed.success) return { error: 'Informe um e-mail válido e sua senha.' };
  const finishAuthAction = beginAuthAction();
  const ticket = lockPrivateData();
  try {
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return { error: error.code === 'invalid_credentials' ? 'E-mail ou senha incorretos. Confira os dados e tente novamente.' : error.status === 429 ? 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.' : 'Não foi possível entrar. Confira sua conexão e tente novamente.' };
    const access = await readAccess();
    if (access.kind === 'member') return redirect(safeReturnTo(new URL(request.url).searchParams.get('next')));
    if (access.kind === 'no-access') return redirect('/sem-acesso');
    return { error: 'Não foi possível verificar sua equipe. Tente novamente.' };
  } catch { return { error: 'Não foi possível conectar ao serviço de acesso. Tente novamente.' }; }
  finally { finishAuthAction(); unlockPrivateData(ticket); }
}

export async function logoutAction({ request }: ActionFunctionArgs) {
  const disposition = (await request.formData()).get('disposition');
  if (hasPendingEdits() && !['exported', 'discarded'].includes(String(disposition))) return { error: 'Há alterações pendentes. Sincronize, exporte o rascunho ou confirme o descarte antes de sair.' };
  const userId = useEditorStore.getState().userId ?? (await supabase?.auth.getSession())?.data.session?.user.id;
  await useEditorStore.getState().flushLocal();
  const finishAuthAction = beginAuthAction();
  const ticket = lockPrivateData();
  try {
    if (supabase) {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) return { error: 'Não foi possível encerrar a sessão. Tente sair novamente.' };
    }
    await useEditorStore.getState().flushLocal();
    if (userId) await clearAccountDrafts(userId);
    return redirect('/login');
  } catch { return { error: 'Não foi possível encerrar a sessão. Confira sua conexão e tente novamente.' }; }
  finally { finishAuthAction(); unlockPrivateData(ticket); }
}
