// Privileged test-only operation: exact identities/workspaces created by this run.
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readTarget } from './validation-run.mjs';
const [runId, userId, status] = process.argv.slice(2);
if (!/^\d{8}-[a-f0-9]{6}$/.test(runId ?? '') || !['active', 'inactive'].includes(status)) throw new Error('Controle de validação inválido.');
const target = readTarget();
const record = JSON.parse(await readFile(`.validation-runs/${runId}.json`, 'utf8'));
if (record.ref !== target.ref || !record.users.includes(userId) || record.workspaces.length !== 2) throw new Error('Identidade fora desta execução.');
const admin = createClient(target.url, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const result = await admin.from('workspace_members').update({ status }).eq('user_id', userId).in('workspace_id', record.workspaces).select('user_id');
if (result.error || result.data.length !== 1) throw new Error('Vínculo temporário não alterado.');
console.log('Vínculo temporário atualizado.');
