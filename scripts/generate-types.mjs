import { spawnSync } from 'node:child_process';
import { rename, writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';

// Types come from the final project (no container). Requires `npx supabase login`
// or SUPABASE_ACCESS_TOKEN in the terminal environment.
const ref = process.env.MAPA_PROJECT_REF;
const url = loadEnv('development', process.cwd(), 'VITE_SUPABASE_').VITE_SUPABASE_URL;
if (!ref || !url || new URL(url).hostname !== `${ref}.supabase.co`) {
  console.error('Defina MAPA_PROJECT_REF igual ao projeto de .env.local. O contrato atual foi preservado.');
  process.exit(1);
}
const result = spawnSync('npx', ['--no-install', 'supabase', 'gen', 'types', 'typescript', '--project-id', ref, '--schema', 'public'], { encoding: 'utf8' });
if (result.status !== 0 || !result.stdout.includes('export type Database')) {
  console.error('Tipos não gerados. Verifique `npx supabase login` e o acesso ao projeto. O contrato atual foi preservado.');
  process.exitCode = 1;
} else {
  // Replace only after a complete write.
  const temporary = 'src/lib/database.types.ts.tmp';
  await writeFile(temporary, result.stdout);
  await rename(temporary, 'src/lib/database.types.ts');
  console.log(`Tipos gerados do projeto ${ref}. Execute typecheck e build.`);
}
