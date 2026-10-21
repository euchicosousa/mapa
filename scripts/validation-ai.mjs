// Server quota fixtures only in this run's disposable workspace. No fake model,
// provider call or test endpoint is installed in the application.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readTarget } from './validation-run.mjs';
const [action, runId, mapId, jobArgument] = process.argv.slice(2);
if (!/^\d{8}-[a-f0-9]{6}$/.test(runId ?? '') || !['hold', 'release', 'inspect'].includes(action))
  throw Error('Escopo de validação inválido.');
const target = readTarget(),
  record = JSON.parse(await readFile(`.validation-runs/${runId}.json`, 'utf8'));
if (record.ref !== target.ref) throw Error('Projeto divergente.');
const admin = createClient(target.url, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const map = await admin.from('maps').select('id,workspace_id').eq('id', mapId).single();
if (map.error || !record.workspaces.includes(map.data.workspace_id)) throw Error('Mapa fora da execução.');
const root = await admin.from('nodes').select('id').eq('map_id', mapId).is('parent_id', null).single();
if (root.error) throw Error('Raiz indisponível.');
const rpc = async (name, args) => {
  const response = await admin.rpc(name, args);
  if (response.error) throw Error(`${name}: ${response.error.message}`);
  return response.data;
};
if (action === 'hold') {
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    await rpc('reserve_ai_generation', {
      p_actor: record.users[0],
      p_map_id: mapId,
      p_parent_node_id: root.data.id,
      p_generation_id: id,
      p_editor_session_id: randomUUID(),
      p_guidance: '',
      p_model: 'validation-quota-fixture',
      p_daily_budget: 50000,
    });
    ids.push(id);
    await rpc('finish_ai_generation', {
      p_generation_id: id,
      p_children: null,
      p_usage: null,
      p_error: 'TEST_QUOTA_FIXTURE',
    });
  }
  process.stdout.write(JSON.stringify(ids));
} else if (action === 'release') {
  const ids = JSON.parse(jobArgument ?? 'null');
  if (!Array.isArray(ids) || ids.length !== 2) throw Error('Lista exata de fixtures obrigatória.');
  for (const id of ids) {
    const job = await admin.from('ai_generations').select('model,error_code,requested_by,map_id').eq('id', id).single();
    if (
      job.error ||
      job.data.model !== 'validation-quota-fixture' ||
      job.data.error_code !== 'TEST_QUOTA_FIXTURE' ||
      job.data.map_id !== mapId ||
      !record.users.includes(job.data.requested_by)
    )
      throw Error('Job fora do escopo da fixture.');
    // These fixtures never contacted the provider: observed cost is exactly zero.
    await rpc('finish_ai_generation', {
      p_generation_id: id,
      p_children: null,
      p_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      p_error: null,
    });
  }
  console.log('Reservas sem chamada real reconciliadas.');
} else {
  const job = await admin
    .from('ai_generations')
    .select('state,usage,usage_day,accounted_tokens,requested_by,map_id,model,created_at,finished_at')
    .eq('id', jobArgument)
    .single();
  if (job.error || job.data.map_id !== mapId || !record.users.includes(job.data.requested_by))
    throw Error('Job fora da execução.');
  process.stdout.write(
    JSON.stringify({
      state: job.data.state,
      usage: job.data.usage,
      usageDay: job.data.usage_day,
      accountedTokens: job.data.accounted_tokens,
      model: job.data.model,
      createdAt: job.data.created_at,
      finishedAt: job.data.finished_at,
    }),
  );
}
