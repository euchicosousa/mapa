import { Form, Link, useActionData, useLoaderData, useNavigation } from 'react-router';
import { ConfigNotice, Page } from './pages';
import {
  passwordMinimum,
  recoveryMessage,
  type requestPasswordAction,
  type savePasswordAction,
} from '../auth/password-actions';

export function InvalidPasswordLink() {
  return (
    <Page title="Link inválido ou expirado" eyebrow="Acesso ao Mapa">
      <div className="access-panel">
        <p>
          Este link não pode ser usado. Ele pode ter expirado ou já ter sido utilizado. Solicite um novo link para
          continuar.
        </p>
        <Link className="button" to="/recuperar-senha">
          Solicitar novo link
        </Link>
        <p>
          <Link className="text-link" to="/login">
            Voltar ao acesso
          </Link>
        </p>
      </div>
    </Page>
  );
}

export function RecoverPasswordPage() {
  const result = useActionData<typeof requestPasswordAction>();
  const busy = useNavigation().state !== 'idle';
  return (
    <Page title="Recuperar senha" eyebrow="Acesso ao Mapa">
      <div className="access-panel">
        <p>
          Informe seu e-mail para receber um link de recuperação. Você poderá abri-lo em outro navegador ou aparelho.
        </p>
        {__PUBLIC_CONFIG__.status !== 'ready' ? (
          <ConfigNotice />
        ) : result?.sent ? (
          <p role="status">{recoveryMessage}</p>
        ) : (
          <Form method="post" className="login-form">
            <div>
              <label htmlFor="recovery-email">E-mail</label>
              <input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                maxLength={254}
                required
              />
            </div>
            {result?.error && (
              <p role="alert" className="form-error">
                {result.error}
              </p>
            )}
            <button className="button" type="submit" disabled={busy}>
              {busy ? 'Solicitando…' : 'Enviar link de recuperação'}
            </button>
          </Form>
        )}
        <p>
          <Link className="text-link" to="/login">
            Voltar ao acesso
          </Link>
        </p>
      </div>
    </Page>
  );
}

export function DefinePasswordPage() {
  const { valid } = useLoaderData<{ valid: boolean }>();
  const result = useActionData<typeof savePasswordAction>();
  const busy = useNavigation().state !== 'idle';
  if (result?.saved)
    return (
      <Page title="Senha salva">
        <p role="status">Sua senha foi salva. Saia desta sessão e entre com a nova senha.</p>
      </Page>
    );
  if (!valid || result?.invalid) return <InvalidPasswordLink />;
  return (
    <Page title="Definir nova senha" eyebrow="Acesso ao Mapa">
      <div className="access-panel">
        <p>Escolha a senha que você usará para entrar no Mapa.</p>
        <Form method="post" className="login-form">
          <div>
            <label htmlFor="new-password">Nova senha</label>
            <input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={passwordMinimum}
              maxLength={1024}
              aria-describedby="password-help"
              required
            />
          </div>
          <p id="password-help">Use pelo menos {passwordMinimum} caracteres. Prefira uma senha longa e exclusiva.</p>
          <div>
            <label htmlFor="confirm-password">Confirmar nova senha</label>
            <input
              id="confirm-password"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              minLength={passwordMinimum}
              maxLength={1024}
              required
            />
          </div>
          {result?.error && (
            <p role="alert" className="form-error">
              {result.error}
            </p>
          )}
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </Form>
      </div>
    </Page>
  );
}
