import { createClient } from '@supabase/supabase-js';

async function bootstrap() {
  const {
    SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: key,
    MAPA_ADMIN_EMAIL: email,
    MAPA_ADMIN_PASSWORD: password,
    MAPA_ADMIN_NAME: name,
    MAPA_WORKSPACE_ID: workspaceId,
    MAPA_WORKSPACE_NAME: workspaceName,
  } = process.env;
  if (!url || !key || !email || !password || !name || !workspaceId || !workspaceName)
    throw new Error('Defina as variáveis administrativas indicadas em docs/AUTH-SUPABASE.md num ambiente seguro.');
  if (!url.startsWith('https://') && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
    throw new Error('Use HTTPS ou Supabase local.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let user;
  for (let page = 1; ; page += 1) {
    const result = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error('Não foi possível consultar identidades.');
    user = result.data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user || result.data.users.length < 1000) break;
  }
  if (!user) {
    const result = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (result.error || !result.data.user) throw new Error('Não foi possível criar a identidade administrativa.');
    user = result.data.user;
  }
  // Re-running preserves an existing identity and password.
  const workspace = await client.from('workspaces').upsert({ id: workspaceId, name: workspaceName });
  if (workspace.error) throw new Error('Não foi possível preparar o espaço. Verifique as migrações.');
  const member = await client
    .from('workspace_members')
    .upsert({ workspace_id: workspaceId, user_id: user.id, role: 'admin', status: 'active' });
  if (member.error) throw new Error('Não foi possível preparar o vínculo administrativo.');
  console.log('Administrador e vínculo preparados. Nenhuma credencial foi registrada.');
}
bootstrap().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
