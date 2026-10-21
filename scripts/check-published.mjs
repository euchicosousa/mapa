import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { readTarget } from './validation-run.mjs';

const origin = 'https://mapa.cnvt.com.br';
const target = readTarget(),
  env = loadEnv('development', process.cwd(), '');
const secrets = [target.secretKey, env.OPENAI_API_KEY, env.VERCEL_OIDC_TOKEN].filter(Boolean);
const evidence = {
  checkedAt: new Date().toISOString(),
  origin,
  routes: [],
  assets: [],
  secretValuesChecked: secrets.length,
  secretsFound: false,
  testMarkersFound: false,
};
const markers = [
  'LOG_CONTENT_PROBE_22',
  'sb_secret_bundle_boundary_test_marker',
  '00000000-0000-4000-8000-000000000003',
  'PRIVATE_MAP_TEXT',
];
const assets = new Set();
function inspect(text) {
  assert.ok(!secrets.some((secret) => text.includes(secret)), 'Privileged value in published response');
  assert.ok(!markers.some((marker) => text.includes(marker)), 'Test fixture marker in published response');
  for (const match of text.matchAll(/(?:assets\/)?((?:index|editor)-[\w-]+\.(?:js|css))/g))
    assets.add(`/assets/${match[1]}`);
}
for (const route of [
  '/',
  '/login',
  '/mapas',
  '/mapas/00000000-0000-4000-8000-000000000099',
  '/auth/callback',
  '/recuperar-senha',
  '/endereco-inexistente',
]) {
  const response = await globalThis.fetch(origin + route);
  assert.equal(response.status, 200);
  assert.equal(new URL(response.url).origin, origin);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  const html = await response.text();
  inspect(html);
  assert.match(html, /id="root"/);
  evidence.routes.push({
    route,
    status: response.status,
    cache: response.headers.get('cache-control'),
    htmlSha256: createHash('sha256').update(html).digest('hex'),
  });
}
const checked = new Set();
let backendFound = false,
  aiEndpointFound = false;
while (checked.size < assets.size) {
  assert.ok(assets.size <= 20, 'Unexpected asset graph');
  for (const path of assets) {
    if (checked.has(path)) continue;
    const response = await globalThis.fetch(origin + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /max-age=31536000/);
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.match(response.headers.get('content-type'), path.endsWith('.js') ? /javascript/ : /text\/css/);
    const text = await response.text();
    inspect(text);
    checked.add(path);
    backendFound ||= text.includes(target.url) && text.includes(target.publicKey);
    aiEndpointFound ||= text.includes('generate-children');
    evidence.assets.push({
      path,
      status: response.status,
      cache: response.headers.get('cache-control'),
      sha256: createHash('sha256').update(text).digest('hex'),
    });
    if (path.endsWith('.js')) {
      const version = text.match(/0\.1\.0\+\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
      if (version) evidence.version = version[0];
    }
  }
}
assert.ok(checked.size >= 4, 'Lazy editor and main assets must be checked');
assert.ok(backendFound, 'Published client must point to the final Supabase project');
assert.ok(aiEndpointFound, 'Published client must use the server AI endpoint');
evidence.finalSupabaseConfigured = backendFound;
evidence.serverAiEndpoint = aiEndpointFound;
const missing = await globalThis.fetch(origin + '/assets/not-existing-deployment.js');
assert.equal(missing.status, 404, 'Missing assets must not receive the SPA fallback');
evidence.missingAssetStatus = missing.status;
await writeFile('.scratch/mapa-mental/evidence/27/published-responses.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(
  JSON.stringify({
    routes: evidence.routes.length,
    assets: checked.size,
    version: evidence.version,
    secretValuesChecked: secrets.length,
    secretsFound: false,
    missingAssetStatus: missing.status,
  }),
);
