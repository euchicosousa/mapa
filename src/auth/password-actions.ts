import { z } from 'zod';
import { redirect, type ActionFunctionArgs } from 'react-router';
import { supabase } from '../lib/supabase';
import { clearPasswordGrant, hasPasswordGrant } from './password-links';
import { beginAuthAction } from './transitions';
import { lockPrivateData, unlockPrivateData } from './privacy';

export const passwordMinimum = 6; // Matches the final project's Auth policy; server also validates.
export const recoveryMessage =
  'Se houver uma conta com esse e-mail, você receberá um link para definir uma nova senha. Confira também a pasta de spam.';

export async function requestPasswordAction({ request }: ActionFunctionArgs) {
  if (!supabase) return { error: 'O serviço de acesso ainda não está configurado.' };
  const email = String((await request.formData()).get('email') ?? '').trim();
  if (!z.email().max(254).safeParse(email).success) return { error: 'Informe um e-mail válido.' };
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('/auth/callback', request.url).href,
    });
    // Never expose whether an address exists. Only transport/rate failures need action.
    if (error && error.status === 429)
      return { error: 'Muitas solicitações. Aguarde alguns minutos antes de tentar novamente.' };
    if (error && (!error.status || error.status >= 500))
      return { error: 'Não foi possível solicitar o link. Confira sua conexão e tente novamente.' };
    return { sent: true };
  } catch {
    return { error: 'Não foi possível solicitar o link. Confira sua conexão e tente novamente.' };
  }
}

export async function savePasswordAction({ request }: ActionFunctionArgs) {
  if (!supabase) return { error: 'O serviço de acesso ainda não está configurado.' };
  const form = await request.formData();
  const password = String(form.get('password') ?? ''),
    confirmation = String(form.get('confirmation') ?? '');
  if (password.length < passwordMinimum || password.length > 1024)
    return { error: `Use uma senha com pelo menos ${passwordMinimum} caracteres e no máximo 1.024.` };
  if (password !== confirmation) return { error: 'As senhas não coincidem. Confira os dois campos.' };
  const finish = beginAuthAction(),
    ticket = lockPrivateData();
  try {
    if (!(await hasPasswordGrant())) return { invalid: true };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.code === 'same_password') return { error: 'Escolha uma senha diferente da senha anterior.' };
      if (error.code === 'weak_password')
        return { error: 'Essa senha não atende aos requisitos de segurança. Escolha uma senha mais forte.' };
      if (error.status === 401 || error.status === 403 || error.code === 'session_not_found') {
        clearPasswordGrant();
        return { invalid: true };
      }
      return { error: 'Não foi possível salvar a senha. Confira sua conexão e tente novamente.' };
    }
    clearPasswordGrant();
    const signedOut = await supabase.auth.signOut({ scope: 'local' });
    if (signedOut.error) return { saved: true };
    return redirect('/login?senha=atualizada');
  } catch {
    return { error: 'Não foi possível conectar ao serviço de acesso. Tente novamente.' };
  } finally {
    finish();
    unlockPrivateData(ticket);
  }
}
