import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { cleanupRun, createRun, readTarget } from '../../scripts/validation-run.mjs';
process.env.MAPA_AI_VALIDATION = '1';
const target = readTarget(),
  run = await createRun(target);
let cleaned = false;
const cleanup = async () => {
  if (!cleaned) {
    await cleanupRun(target, run.runId);
    cleaned = true;
  }
};
after(cleanup);
const options = { auth: { persistSession: false, autoRefreshToken: false } },
  admin = createClient(target.url, target.secretKey, options),
  clients = [];
try {
  for (const account of run.accounts) {
    const client = createClient(target.url, target.publicKey, options);
    const response = await client.auth.signInWithPassword({ email: account.email, password: account.password });
    assert.equal(response.error, null);
    clients.push(client);
  }
} catch (error) {
  await cleanup();
  throw error;
}
const rpc = async (client, name, args) => {
  const r = await client.rpc(name, args);
  assert.equal(r.error, null, `${name}: ${r.error?.message}`);
  return r.data;
};
let first, second, winner;
const claims = [];
for (let i = 0; i < 2; i++) {
  const session = randomUUID(),
    made = await rpc(clients[0], 'create_map', {
      p_workspace_id: run.workspaces.X.id,
      p_operation_id: randomUUID(),
      p_editor_session_id: session,
      p_title: `Last balance ${i}`,
    });
  const doc = await rpc(clients[0], 'get_map_document', { p_map_id: made.mapId });
  claims.push({
    p_actor: run.accounts[i].id,
    p_map_id: made.mapId,
    p_parent_node_id: doc.nodes[0].id,
    p_generation_id: randomUUID(),
    p_editor_session_id: session,
    p_guidance: '',
    p_model: 'quota-no-provider-call',
    p_daily_budget: 17000,
  });
}
test('two users racing for the last 17,000 tokens reserve exactly one job', async () => {
  const results = await Promise.all(claims.map((args) => admin.rpc('reserve_ai_generation', args)));
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(results.filter((r) => r.error?.message === 'AI_BUDGET_LIMIT').length, 1);
  winner = results.findIndex((r) => !r.error);
  first = claims[winner];
  second = claims[1 - winner];
  const jobs = await admin
    .from('ai_generations')
    .select('id,accounted_tokens')
    .in(
      'id',
      claims.map((c) => c.p_generation_id),
    );
  assert.equal(jobs.error, null);
  assert.equal(jobs.data.length, 1);
  assert.equal(jobs.data[0].accounted_tokens, 17000);
});
test('replay and cancellation do not free the last balance or change its debit', async () => {
  assert.ok(first);
  const replay = await rpc(admin, 'reserve_ai_generation', first);
  assert.equal(replay.claimed, false);
  const cancelled = await rpc(clients[winner], 'cancel_ai_generation', {
    p_map_id: first.p_map_id,
    p_generation_id: first.p_generation_id,
  });
  assert.equal(cancelled.state, 'cancelled');
  const denied = await admin.rpc('reserve_ai_generation', { ...second, p_generation_id: randomUUID() });
  assert.equal(denied.error?.message, 'AI_BUDGET_LIMIT');
  await rpc(admin, 'finish_ai_generation', {
    p_generation_id: first.p_generation_id,
    p_children: null,
    p_usage: null,
    p_error: 'TIMEOUT',
  });
  const unknown = await admin
    .from('ai_generations')
    .select('accounted_tokens,state')
    .eq('id', first.p_generation_id)
    .single();
  assert.equal(unknown.data.accounted_tokens, 17000);
  assert.equal(unknown.data.state, 'cancelled');
});
test('ordinary users cannot supply provider usage, change settings or clear the server accounting', async () => {
  assert.ok(first);
  const denied = await clients[winner].rpc('finish_ai_generation', {
    p_generation_id: first.p_generation_id,
    p_children: null,
    p_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    p_error: null,
  });
  assert.ok(denied.error);
  const changed = await clients[winner]
    .from('ai_generations')
    .update({ accounted_tokens: 0 })
    .eq('id', first.p_generation_id)
    .select('id');
  assert.ok(changed.error || changed.data.length === 0);
  const job = await admin.from('ai_generations').select('accounted_tokens').eq('id', first.p_generation_id).single();
  assert.equal(job.data.accounted_tokens, 17000);
});
