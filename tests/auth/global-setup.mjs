import { spawnSync } from 'node:child_process';

// Supabase code runs in a plain Node child: under Playwright's module hooks, Node 22
// crashes loading supabase-js (ERR_INTERNAL_ASSERTION, "Unexpected module status 3").
// The child checks the target before creating anything. Credentials travel only
// through the pipe and the process environment, never disk.
function validationRun(...args) {
  const result = spawnSync(process.execPath, ['scripts/validation-run.mjs', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0) throw new Error(`validation-run ${args[0]} falhou.`);
  return result.stdout;
}

export default async function globalSetup() {
  const output = validationRun('create');
  const { runId } = JSON.parse(output);
  process.env.MAPA_VALIDATION_RUN = output;
  return async () => {
    // Per-file runs first (tests/auth/file-run.ts), then the run used for test listing.
    validationRun('cleanup-children', runId);
    validationRun('cleanup', runId);
  };
}
