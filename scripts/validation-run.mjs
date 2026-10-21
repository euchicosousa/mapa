// Temporary validation identities in the final Supabase project (contract section 7).
// Every resource is recorded by exact ID before use and removed only by those IDs.
// Passwords are random, kept in memory and never written to disk or logs.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const runsDir = '.validation-runs';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const roles = [
  { key: 'A', workspace: 'X', role: 'admin' },
  { key: 'B', workspace: 'X', role: 'member' },
  { key: 'C', workspace: 'Y', role: 'member' },
  { key: 'D', workspace: null, role: null },
];

// Optional local file with only the two validation variables. It must be private
// to the user (chmod 600); variables already in the environment take precedence.
// Vite never loads it: it only reads VITE_SUPABASE_* and never runs in "validation" mode.
const validationFile = '.env.validation';
function loadValidationFile() {
  let text;
  try { text = readFileSync(validationFile, 'utf8'); } catch { return; }
  if (statSync(validationFile).mode & 0o077) throw new Error(`${validationFile} precisa ser privado: rode chmod 600 ${validationFile}.`);
  // Accepts one variable per line or a pasted `export A=… B='…'` line.
  for (const name of ['MAPA_PROJECT_REF', 'SUPABASE_SECRET_KEY']) {
    const match = text.match(new RegExp(`(?:^|\\s)${name}=('[^']*'|"[^"]*"|[^\\s;&]+)`));
    if (match && !process.env[name]) process.env[name] = match[1].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export function readTarget() {
  loadValidationFile();
  const env = loadEnv('development', process.cwd(), 'VITE_SUPABASE_');
  const ref = process.env.MAPA_PROJECT_REF;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const url = env.VITE_SUPABASE_URL;
  const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!ref || !secretKey) throw new Error(`Defina MAPA_PROJECT_REF e SUPABASE_SECRET_KEY no ambiente ou em ${validationFile} (chmod 600).`);
  if (!url || !publicKey) throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY em .env.local.');
  // The frontend config and the administrative key must point at the same expected project.
  if (new URL(url).hostname !== `${ref}.supabase.co`) throw new Error(`.env.local não aponta para o projeto esperado ${ref}.`);
  if (secretKey.startsWith('sb_publishable_') || secretKey === publicKey) throw new Error('SUPABASE_SECRET_KEY precisa ser a chave secreta, não a publicável.');
  return { ref, url, publicKey, secretKey };
}

const adminClient = (target) => createClient(target.url, target.secretKey, options);
const recordPath = (runId) => `${runsDir}/${runId}.json`;
// Only IDs are persisted, so an interrupted run can still be cleaned exactly.
async function saveRecord(record) {
  await mkdir(runsDir, { recursive: true, mode: 0o700 });
  await writeFile(recordPath(record.runId), JSON.stringify(record, null, 2), { mode: 0o600 });
}

export async function createRun(target) {
  const runId = `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex')}`;
  const record = { runId, ref: target.ref, createdAt: new Date().toISOString(), workspaces: [], users: [] };
  const admin = adminClient(target);
  const run = { runId, workspaces: {}, accounts: [] };
  try {
    await saveRecord(record);
    for (const label of ['X', 'Y']) {
      const workspace = { id: randomUUID(), name: `Validação ${runId} ${label}` };
      record.workspaces.push(workspace.id); await saveRecord(record);
      const { error } = await admin.from('workspaces').insert(workspace);
      if (error) throw new Error('Não foi possível criar o espaço temporário.');
      run.workspaces[label] = workspace;
    }
    for (const entry of roles) {
      const email = `mapa-validacao-${runId}-${entry.key.toLowerCase()}@example.com`;
      const password = randomBytes(24).toString('base64url');
      const name = `Validação ${entry.key} ${runId}`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
      if (created.error || !created.data.user) throw new Error('Não foi possível criar a conta temporária.');
      record.users.push(created.data.user.id); await saveRecord(record);
      if (entry.workspace) {
        const { error } = await admin.from('workspace_members').insert({ workspace_id: run.workspaces[entry.workspace].id, user_id: created.data.user.id, role: entry.role, status: 'active' });
        if (error) throw new Error('Não foi possível criar o vínculo temporário.');
      }
      if (process.env.MAPA_AI_VALIDATION==='1' && ['A','B'].includes(entry.key)) {
        const access=await admin.rpc('set_ai_validation_access',{p_user_id:created.data.user.id,p_enabled:true});
        if(access.error)throw Error('Não foi possível liberar IA para a identidade temporária.');
      }
      run.accounts.push({ ...entry, id: created.data.user.id, email, password, name });
    }
    return run;
  } catch (error) {
    await cleanupRun(target, record.runId).catch(() => {});
    throw error;
  }
}

// Registers an identity created unexpectedly during the run (e.g. a signup that should be refused).
export async function trackUser(runId, userId) {
  const record = JSON.parse(await readFile(recordPath(runId), 'utf8'));
  if (!record.users.includes(userId)) record.users.push(userId);
  await saveRecord(record);
}

export async function cleanupRun(target, runId) {
  const record = JSON.parse(await readFile(recordPath(runId), 'utf8'));
  if (record.ref !== target.ref) throw new Error(`Registro ${runId} pertence a outro projeto.`);
  const admin = adminClient(target);
  const failures = [];
  // FK order: maps (cascading nodes/operations/preferences) → projects → memberships → profiles → workspaces → Auth identities.
  // Maps are removed only inside this run's temporary workspaces.
  if (record.workspaces.length) {
    const invitations = await admin.from('workspace_invitations').delete().in('workspace_id', record.workspaces);
    if (invitations.error) failures.push('convites');
    const maps = await admin.from('maps').delete().in('workspace_id', record.workspaces);
    if (maps.error) failures.push('mapas');
    const projects = await admin.from('projects').delete().in('workspace_id', record.workspaces);
    if (projects.error) failures.push('projetos');
    const { error } = await admin.from('workspace_members').delete().in('workspace_id', record.workspaces);
    if (error) failures.push('vínculos por espaço');
  }
  if (record.users.length) {
    const members = await admin.from('workspace_members').delete().in('user_id', record.users);
    if (members.error) failures.push('vínculos por conta');
    const profiles = await admin.from('profiles').delete().in('id', record.users);
    if (profiles.error) failures.push('perfis');
  }
  if (record.workspaces.length) {
    const { error } = await admin.from('workspaces').delete().in('id', record.workspaces);
    if (error) failures.push('espaços');
  }
  for (const id of record.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && error.status !== 404) failures.push(`conta ${id}`);
  }
  if (failures.length) throw new Error(`Limpeza incompleta da execução ${runId}: ${failures.join(', ')}. Registro preservado em ${recordPath(runId)}.`);
  await rm(recordPath(runId));
  return record;
}

export async function cleanupPending(target) {
  const files = await readdir(runsDir).catch(() => []);
  const cleaned = [];
  for (const file of files.filter((name) => name.endsWith('.json'))) cleaned.push((await cleanupRun(target, file.slice(0, -5))).runId);
  return cleaned;
}

// Browser tests may change only a recorded, temporary non-admin membership.
async function setValidationMembership(target,runId,userId,status) {
  if(!/^\d{8}-[a-f0-9]{6}$/.test(runId??'')||!['active','inactive'].includes(status))throw Error('Escopo de validação inválido.');
  const record=JSON.parse(await readFile(recordPath(runId),'utf8'));
  if(record.ref!==target.ref||!record.users.includes(userId)||!record.workspaces.length)throw Error('A conta não pertence à execução de validação.');
  const result=await adminClient(target).from('workspace_members').update({status}).eq('user_id',userId).in('workspace_id',record.workspaces).eq('role','member').select('user_id');
  if(result.error||result.data.length!==1)throw Error('Não foi possível alterar o vínculo temporário.');
}

// CLI. `create` prints the run (with passwords) to stdout only, for a parent process pipe.
const [command, runId] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const actions = {
    'membership-status':async()=>setValidationMembership(readTarget(),runId,process.argv[4],process.argv[5]),
    create: async () => process.stdout.write(JSON.stringify(await createRun(readTarget()))),
    cleanup: async () => {
      if (runId) { await cleanupRun(readTarget(), runId); return console.error(`Execução ${runId} limpa.`); }
      const runs = await cleanupPending(readTarget());
      console.log(runs.length ? `Execuções limpas: ${runs.join(', ')}` : 'Nenhuma execução pendente.');
    },
  };
  if (!actions[command]) { console.error('Uso: validation-run.mjs create | cleanup [run_id] | membership-status run_id user_id active|inactive'); process.exitCode = 1; }
  else actions[command]().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
