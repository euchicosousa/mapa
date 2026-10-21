import { spawnSync } from 'node:child_process';

export function localStatus() {
  const status = spawnSync('npx', ['--no-install', 'supabase', 'status', '--output', 'json'], { encoding: 'utf8' });
  if (status.status !== 0) throw new Error('Supabase local indisponível. Inicie Docker/Podman e execute npx supabase start.');
  let config;
  try { config = JSON.parse(status.stdout); } catch { throw new Error('A CLI não retornou configuração local JSON válida.'); }
  const url = config.API_URL;
  if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('Este comando aceita somente Supabase local loopback.');
  if (!config.ANON_KEY || !config.SERVICE_ROLE_KEY) throw new Error('Chaves locais não disponíveis na saída da CLI.');
  return { url, publicKey: config.ANON_KEY, serviceKey: config.SERVICE_ROLE_KEY };
}
