import { spawnSync } from 'node:child_process';
import { test } from '@playwright/test';
import type { Run } from '../../scripts/validation-run.mjs';

// Same reason as global-setup.mjs: supabase-js runs in a plain Node child, and
// credentials travel only through the pipe.
function validationRun(...args: string[]) {
  const result = spawnSync(process.execPath, ['scripts/validation-run.mjs', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0) throw new Error(`validation-run ${args[0]} falhou.`);
  return result.stdout;
}

// Each spec file, in each project, gets its own accounts and workspaces: a file
// that changes a password, a membership or a workspace's maps cannot affect
// another. The main process only lists tests, so it reuses the global run's shape.
// Global teardown removes every child run, including files whose tests were all
// skipped and whose afterAll therefore never ran.
export function fileRun(): Run {
  const global = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run | null;
  if (!global) throw new Error('Execução de validação ausente; rode pelo playwright.auth.config.ts.');
  if (process.env.TEST_WORKER_INDEX === undefined) return global;
  const run = JSON.parse(validationRun('create', global.runId)) as Run;
  test.afterAll(() => {
    validationRun('cleanup', run.runId);
  });
  return run;
}
