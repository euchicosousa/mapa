import { writeFile } from 'node:fs/promises';
import { localStatus } from './local-supabase.mjs';
try {
  const config = localStatus();
  await writeFile('.env.local', `VITE_SUPABASE_URL=${config.url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${config.publicKey}\n`, { flag: 'wx', mode: 0o600 });
  console.log('.env.local criado apenas com configuração pública. Reinicie o Vite.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? '.env.local já existe; preserve e confira os dois campos públicos.' : error.message);
  process.exitCode = 1;
}
