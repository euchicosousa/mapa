// Administrative test helper. Output travels only through the parent process pipe.
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import { readTarget, trackUser } from './validation-run.mjs';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString());
const target = readTarget();
const record = JSON.parse(await readFile(`.validation-runs/${input.runId}.json`, 'utf8'));
if (record.ref !== target.ref || target.ref !== 'bodxafqkqlyfoyfgahyj') throw Error('Wrong validation scope');
const admin = createClient(target.url, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const invite = input.kind === 'invite';
let email;
if (invite) email = `mapa-link-${input.runId}-${randomBytes(4).toString('hex')}@example.com`;
else {
  if (!record.users.includes(input.userId)) throw Error('Identity not owned by this validation run');
  const found = await admin.auth.admin.getUserById(input.userId);
  if (found.error || !found.data.user) throw Error('Validation identity missing');
  email = found.data.user.email;
}
const origin = input.origin ?? 'http://127.0.0.1:4174';
if (!['http://127.0.0.1:4174', 'https://mapa.cnvt.com.br'].includes(origin))
  throw Error('Callback origin not authorized');
const { data, error } = await admin.auth.admin.generateLink({
  type: invite ? 'invite' : 'recovery',
  email,
  options: { redirectTo: `${origin}/auth/callback` },
});
if (error || !data.user) throw Error('Could not generate validation link');
if (invite) await trackUser(input.runId, data.user.id);
process.stdout.write(
  JSON.stringify({ link: data.properties.action_link, email, password: randomBytes(24).toString('base64url') }),
);
