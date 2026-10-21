import { useEffect, type ReactNode } from 'react';
import { Form, Link, useActionData, useNavigation, useRouteError, useSearchParams } from 'react-router';
import type { loginAction } from '../auth/actions';
import { captureFailure } from '../lib/diagnostics';

export function Page({
  title,
  eyebrow = 'Espaço da equipe',
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Mapa`;
  }, [title]);
  return (
    <section className="page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

export function ConfigNotice() {
  const config = __PUBLIC_CONFIG__;
  if (config.status === 'ready') return null;
  return (
    <aside className="config-notice" aria-labelledby="config-title">
      <span className="notice-icon" aria-hidden="true">
        i
      </span>
      <div>
        <h2 id="config-title">Configuração necessária</h2>
        <p>O acesso ainda não está configurado neste ambiente.</p>
        <details>
          <summary>Como configurar o ambiente</summary>
          <p>
            Preencha as variáveis abaixo em <code>.env.local</code>, usando a URL do projeto Supabase e a chave
            publicável (ou anon local). Depois, reinicie o app.
          </p>
          <ul>
            {config.fields.map((field) => (
              <li key={field}>
                <code>{field}</code>
              </li>
            ))}
          </ul>
          <p>Consulte o README do projeto. Use somente a chave pública; as chaves secretas ficam no servidor.</p>
        </details>
      </div>
    </aside>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const result = useActionData<typeof loginAction>();
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';
  const configured = __PUBLIC_CONFIG__.status === 'ready';
  return (
    <Page title="Um lugar para suas próximas ideias." eyebrow="Bem-vindo ao Mapa">
      <p className="lead">Organize pensamentos, conecte caminhos e construa com a sua equipe.</p>
      <div className="access-panel">
        <span className="section-number">01 / ACESSO</span>
        <h2>Entrar no espaço da equipe</h2>
        {params.get('senha') === 'atualizada' && <p role="status">Senha salva. Entre com sua nova senha.</p>}
        {configured ? (
          <Form method="post" className="login-form">
            <div>
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                maxLength={254}
                required
              />
            </div>
            <div>
              <label htmlFor="password">Senha</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={1024}
                required
              />
            </div>
            {result?.error && (
              <p className="form-error" role="alert">
                {result.error}
              </p>
            )}
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? 'Entrando…' : 'Entrar'}
            </button>
          </Form>
        ) : (
          <>
            <p>Configure o ambiente para entrar com seu e-mail e senha.</p>
            <ConfigNotice />
          </>
        )}
        <Link className="text-link" to="/recuperar-senha">
          Recuperar senha <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <p className="support-copy">Acesso restrito a pessoas convidadas pela equipe.</p>
    </Page>
  );
}

export function UnavailablePage({ title, description }: { title: string; description: string }) {
  return (
    <Page title={title}>
      <div className="access-panel">
        <span className="section-number">EM PREPARAÇÃO</span>
        <h2>Indisponível nesta etapa</h2>
        <p>{description}</p>
        <ConfigNotice />
        <Link className="button" to="/login">
          Voltar ao acesso
        </Link>
      </div>
    </Page>
  );
}

export function NotFoundPage() {
  return (
    <Page title="Página não encontrada" eyebrow="404">
      <p className="lead">Este endereço não corresponde a uma página do Mapa.</p>
      <Link className="button" to="/login">
        Ir para o acesso
      </Link>
    </Page>
  );
}

export function RouteErrorPage() {
  useRouteError(); // Deliberately do not render raw errors, URLs or configuration.
  useEffect(() => {
    captureFailure('route');
  }, []);
  return (
    <main className="error-page">
      <Page title="Não foi possível abrir esta página">
        <p>
          Tente carregar novamente. Se havia alterações neste navegador, reconecte-se e entre na mesma conta para
          recuperar o rascunho.
        </p>
        <div className="error-actions">
          <button className="button" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
          <a className="text-link" href="/login">
            Voltar ao acesso
          </a>
        </div>
      </Page>
    </main>
  );
}
