import { createClient } from '@supabase/supabase-js';
import { localStatus } from './local-supabase.mjs';
import { fixtures, fixturePassword } from './fixtures.mjs';

async function seed() {
  const config = localStatus();
  const admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existing.error) throw new Error('Não foi possível consultar as identidades locais.');
  for (const fixture of fixtures) {
    const user = existing.data.users.find((entry) => entry.email === fixture.email);
    const result = user ? await admin.auth.admin.updateUserById(user.id, { password: fixturePassword, email_confirm: true, user_metadata: { display_name: fixture.name } }) : await admin.auth.admin.createUser({ email: fixture.email, password: fixturePassword, email_confirm: true, user_metadata: { display_name: fixture.name } });
    if (result.error || !result.data.user) throw new Error('Falha ao preparar identidade local.');
    if (fixture.workspace) {
      const { error } = await admin.from('workspace_members').upsert({ workspace_id: fixture.workspace, user_id: result.data.user.id, role: fixture.role, status: 'active' });
      if (error) throw new Error('Falha ao preparar vínculo local. Execute db reset antes do seed.');
    }
  }
  console.log('Fixtures A/B/C/D prontas no Supabase local real.');
}
seed().catch((error) => { console.error(error.message); process.exitCode = 1; });
