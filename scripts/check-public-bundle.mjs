import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Synthetic markers only. No real credential or external request is used.
const secretMarker = 'sb_secret_bundle_boundary_test_marker';
const extraMarker = 'unrelated_private_bundle_test_marker';
const aiSecretMarker = 'sk-bundle-boundary-ai-private-marker';
const oidcMarker = 'private-vercel-oidc-bundle-marker';
const publicMarker = 'sb_publishable_bundle_boundary_test_marker';
const directory = await mkdtemp(join(tmpdir(), 'mapa-bundle-'));
try {
  for (const [name, key] of [['invalid', secretMarker], ['public', publicMarker]]) {
    const output = join(directory, name);
    const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', output], {
      encoding: 'utf8',
      env: { ...process.env, VITE_SUPABASE_URL: 'https://bundle-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key, VITE_UNRELATED_SECRET: extraMarker, OPENAI_API_KEY: aiSecretMarker, VERCEL_OIDC_TOKEN: oidcMarker },
    });
    assert.equal(build.status, 0, 'Bundle validation build must succeed');
    const assets = join(output, 'assets');
    const code = (await Promise.all((await readdir(assets)).filter((file) => file.endsWith('.js')).map((file) => readFile(join(assets, file), 'utf8')))).join('\n');
    assert.ok(!code.includes(secretMarker), 'Privileged key must be removed');
    assert.ok(!code.includes(aiSecretMarker), 'OpenAI key must never reach the browser');
    assert.ok(!code.includes(oidcMarker), 'Vercel OIDC token must never reach the browser');
    assert.ok(!code.includes(extraMarker), 'Unapproved VITE variable must not be exposed');
    assert.equal(code.includes('Configuração necessária'), name === 'invalid', 'Validated configuration selects the correct initial UI');
    console.log(`Public bundle boundary: ${name} configuration passed`);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
