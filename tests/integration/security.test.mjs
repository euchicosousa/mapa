import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readTarget, createRun, cleanupRun } from '../../scripts/validation-run.mjs';
// Actor assertions use real JWTs and the public key. Service only prepares scoped
// fixtures, simulates the trusted worker, and verifies invariants/cleans its IDs.
let target, run, service, actors, accounts, x, y, ix, iy;
const evidence = [];
const record = (boundary, actor, result) => evidence.push({ boundary, actor, result });
const rpc = async (client, name, args) => {
  const r = await client.rpc(name, args);
  assert.equal(r.error, null, `${name}: ${r.error?.message}`);
  return r.data;
};
const doc = (client, id) => rpc(client, 'get_map_document', { p_map_id: id });
const command = (client, map, revision, kind, payload, operation = uuid(), session = uuid()) =>
  client.rpc('apply_map_command', {
    p_map_id: map,
    p_expected_revision: revision,
    p_kind: kind,
    p_payload: payload,
    p_operation_id: operation,
    p_editor_session_id: session,
  });
before(async () => {
  target = readTarget();
  run = await createRun(target);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  service = createClient(target.url, target.secretKey, options);
  actors = {};
  accounts = {};
  for (const account of run.accounts) {
    const client = createClient(target.url, target.publicKey, options);
    assert.equal(
      (await client.auth.signInWithPassword({ email: account.email, password: account.password })).error,
      null,
    );
    actors[account.key] = client;
    accounts[account.key] = account;
  }
  actors.anon = createClient(target.url, target.publicKey, options);
  async function fixture(key, workspace) {
    const made = await rpc(actors[key], 'create_map', {
      p_workspace_id: workspace,
      p_operation_id: uuid(),
      p_editor_session_id: uuid(),
      p_title: `Security ${run.runId} ${key}`,
    });
    const initial = await doc(actors[key], made.mapId),
      project = uuid();
    await rpc(actors[key], 'create_project', {
      p_project_id: project,
      p_workspace_id: workspace,
      p_name: `Projeto ${key}`,
      p_client_name: null,
    });
    return { id: made.mapId, root: initial.nodes[0].id, workspace, project, initial };
  }
  x = await fixture('B', run.workspaces.X.id);
  y = await fixture('C', run.workspaces.Y.id);
  for (const key of ['A', 'B', 'C']) {
    const map = key === 'C' ? y : x;
    assert.equal(
      (
        await actors[key].from('map_user_preferences').insert({
          map_id: map.id,
          user_id: accounts[key].id,
          viewport: { x: 0, y: 0, zoom: 1 },
          collapsed_node_ids: [],
        })
      ).error,
      null,
    );
  }
  ix = uuid();
  iy = uuid();
  assert.equal(
    (
      await service.from('workspace_invitations').insert([
        {
          id: ix,
          workspace_id: x.workspace,
          email: accounts.D.email,
          invited_by: accounts.A.id,
          auth_user_id: accounts.D.id,
          delivery_state: 'existing',
        },
        {
          id: iy,
          workspace_id: y.workspace,
          email: accounts.D.email,
          invited_by: accounts.C.id,
          auth_user_id: accounts.D.id,
          delivery_state: 'existing',
        },
      ])
    ).error,
    null,
  ); // No email dispatch; C may retain a past invitation after losing admin.
});
after(async () => {
  try {
    await writeFile(
      '.scratch/mapa-mental/evidence/25/http-matrix.json',
      JSON.stringify({ project: target?.ref, assertions: evidence }, null, 2),
    );
  } finally {
    if (run) await cleanupRun(target, run.runId);
  }
});

test('SELECT on every exposed table: exact A/B/C/D scopes and anonymous denial', async () => {
  const ids = run.accounts.map((a) => a.id),
    peers = { A: ids.slice(0, 2), B: ids.slice(0, 2), C: [ids[2]], D: [] };
  const same = (left, right) => ({ A: [left], B: [left], C: [right], D: [] });
  const tables = [
    ['workspaces', 'id', [x.workspace, y.workspace], same(x.workspace, y.workspace)],
    ['workspace_members', 'user_id', ids, peers],
    ['profiles', 'id', ids, peers],
    ['maps', 'id', [x.id, y.id], same(x.id, y.id)],
    ['nodes', 'id', [x.root, y.root], same(x.root, y.root)],
    ['projects', 'id', [x.project, y.project], same(x.project, y.project)],
    ['workspace_invitations', 'id', [ix, iy], { A: [ix], B: [], C: [], D: [] }],
    ['map_user_preferences', 'user_id', ids, { A: [ids[0]], B: [ids[1]], C: [ids[2]], D: [] }],
    ['map_operations', 'map_id', [x.id, y.id], null],
    ['ai_generations', 'map_id', [x.id, y.id], null],
  ];
  for (const [table, col, filter, expected] of tables)
    for (const [key, client] of Object.entries(actors)) {
      const r = await client.from(table).select('*').in(col, filter);
      if (key === 'anon' || !expected) assert.equal(r.error?.code, '42501', `${key} SELECT ${table}`);
      else {
        assert.equal(r.error, null);
        assert.deepEqual(r.data.map((row) => row[col]).sort(), [...expected[key]].sort(), `${key} SELECT ${table}`);
      }
      record(
        `SELECT ${table}`,
        key,
        key === 'anon' || !expected ? 'permission denied' : `${r.data.length} scoped rows`,
      );
    }
});
test('INSERT/UPDATE/DELETE of all protected tables denied, including forged owner, creator, source and role', async () => {
  const rows = {
    workspaces: { id: x.workspace, name: 'forged' },
    workspace_members: { workspace_id: x.workspace, user_id: accounts.D.id, role: 'admin', status: 'active' },
    profiles: { id: accounts.B.id, display_name: 'forged' },
    maps: {
      id: x.id,
      workspace_id: x.workspace,
      owner_id: accounts.A.id,
      created_by: accounts.A.id,
      updated_by: accounts.A.id,
      title: 'forged',
    },
    nodes: {
      id: x.root,
      map_id: x.id,
      parent_id: null,
      text: 'forged',
      created_by: accounts.A.id,
      updated_by: accounts.A.id,
      source: 'ai',
      sort_order: 0,
    },
    projects: { id: x.project, workspace_id: x.workspace, name: 'forged', created_by: accounts.A.id },
    workspace_invitations: { id: ix, workspace_id: x.workspace, email: accounts.D.email, invited_by: accounts.A.id },
    map_operations: { id: uuid(), map_id: x.id, actor_id: accounts.A.id },
    ai_generations: { id: uuid(), map_id: x.id, requested_by: accounts.A.id },
  };
  for (const [table, row] of Object.entries(rows))
    for (const [key, client] of Object.entries(actors)) {
      const col = table === 'workspace_members' ? 'workspace_id' : 'id',
        value = row[col];
      for (const [kind, request] of [
        ['INSERT', client.from(table).insert(row)],
        ['UPDATE', client.from(table).update(row).eq(col, value)],
        ['DELETE', client.from(table).delete().eq(col, value)],
      ]) {
        const r = await request;
        assert.equal(r.error?.code, '42501', `${key} ${kind} ${table}`);
        record(`${kind} ${table}`, key, 'permission denied');
      }
    }
  assert.deepEqual(await doc(actors.B, x.id), x.initial);
});
test('preferences allow own CRUD but cannot move identity or workspace or overwrite a colleague', async () => {
  const before = await actors.B.from('map_user_preferences').select('*').eq('map_id', x.id);
  assert.equal(before.error, null);
  for (const patch of [{ user_id: accounts.A.id }, { map_id: y.id }])
    assert.equal((await actors.B.from('map_user_preferences').update(patch).eq('map_id', x.id)).error?.code, '42501');
  for (const [key, client] of Object.entries(actors)) {
    if (key === 'B') continue;
    assert.equal(
      (
        await client
          .from('map_user_preferences')
          .upsert({ map_id: x.id, user_id: accounts.B.id, viewport: { x: 1, y: 2, zoom: 1 }, collapsed_node_ids: [] })
      ).error?.code,
      '42501',
    );
    record('preferences other identity', key, 'denied');
  }
  assert.deepEqual((await actors.B.from('map_user_preferences').select('*').eq('map_id', x.id)).data, before.data);
  assert.equal(
    (
      await actors.B.from('map_user_preferences')
        .update({ viewport: { x: 1, y: 2, zoom: 0.8 } })
        .eq('map_id', x.id)
    ).error,
    null,
  );
  assert.equal((await actors.B.from('map_user_preferences').delete().eq('map_id', x.id)).error, null);
  assert.equal((await actors.B.from('map_user_preferences').insert(before.data)).error, null);
  record('preferences own CRUD', 'B', 'allowed');
});
test('admin X cannot administer Y by UUID; user_metadata never grants admin or workspace access', async () => {
  const before = await doc(actors.C, y.id);
  assert.equal(await doc(actors.A, y.id), null);
  assert.equal(
    (await actors.A.rpc('set_member_access', { p_workspace: y.workspace, p_user: accounts.C.id, p_status: 'inactive' }))
      .error?.message,
    'FORBIDDEN',
  );
  for (const [kind, payload] of [
    ['delete_map', {}],
    ['transfer_owner', { ownerId: accounts.A.id }],
    ['edit_text', { nodeId: y.root, text: 'forged' }],
  ])
    assert.ok((await command(actors.A, y.id, 1, kind, payload)).error);
  assert.ok(
    (
      await actors.A.rpc('create_map', {
        p_workspace_id: y.workspace,
        p_operation_id: uuid(),
        p_editor_session_id: uuid(),
      })
    ).error,
  );
  const edge = await actors.A.functions.invoke('manage-invitation', {
    body: { action: 'revoke', workspaceId: y.workspace, invitationId: iy },
  });
  assert.equal(edge.error?.context.status, 403);
  for (const key of ['B', 'C', 'D']) {
    assert.equal(
      (
        await actors[key].auth.updateUser({
          data: { role: 'admin', workspace_id: x.workspace, app_metadata: { role: 'service_role' } },
        })
      ).error,
      null,
    );
    assert.ok(
      (
        await actors[key].rpc('set_member_access', {
          p_workspace: x.workspace,
          p_user: accounts.A.id,
          p_status: 'inactive',
        })
      ).error,
    );
    record('forged user_metadata', key, 'no escalation');
  }
  assert.deepEqual(await doc(actors.C, y.id), before);
  record('admin X targeting Y UUIDs', 'A', 'denied');
});
test('private schema is not exposed and every service-only RPC rejects ordinary JWTs and anon', async () => {
  const calls = [
    [
      'reserve_ai_generation',
      {
        p_actor: accounts.A.id,
        p_map_id: x.id,
        p_parent_node_id: x.root,
        p_generation_id: uuid(),
        p_editor_session_id: uuid(),
        p_guidance: '',
        p_model: 'security-no-provider',
        p_daily_budget: 50000,
      },
    ],
    ['finish_ai_generation', { p_generation_id: uuid(), p_children: null, p_usage: null, p_error: 'FORGED' }],
    ['set_ai_validation_access', { p_user_id: accounts.D.id, p_enabled: true }],
    ['ai_generation_available', { p_actor: accounts.A.id }],
    [
      'reserve_workspace_invitation',
      { p_actor: accounts.A.id, p_action: 'revoke', p_workspace: x.workspace, p_id: ix, p_email: null },
    ],
    ['finish_workspace_invitation', { p_id: ix, p_attempt: uuid(), p_outcome: 'sent' }],
  ];
  for (const [key, client] of Object.entries(actors)) {
    assert.equal(
      (await client.schema('private').rpc('is_active_member', { target_workspace_id: x.workspace })).error?.code,
      'PGRST106',
    );
    record('private schema HTTP', key, 'not exposed');
    for (const [name, args] of calls) {
      assert.equal((await client.rpc(name, args)).error?.code, '42501', `${key} ${name}`);
      record(name, key, 'permission denied');
    }
  }
});
test('AI HTTP refuses forged actor/usage/source and foreign workspaces before any provider request', async () => {
  const before = await doc(actors.A, x.id),
    body = { mapId: x.id, parentNodeId: x.root, generationId: uuid(), editorSessionId: uuid(), guidance: '' };
  for (const patch of [
    { actor: accounts.A.id },
    { source: 'ai' },
    { usage: { total_tokens: 0 } },
    { children: [{ text: 'injetado' }] },
  ])
    assert.equal(
      (await actors.B.functions.invoke('generate-children', { body: { ...body, ...patch } })).error?.context.status,
      400,
    );
  for (const key of ['C', 'D']) {
    const r = await actors[key].functions.invoke('generate-children', { body });
    assert.ok([403, 404].includes(r.error?.context.status), `${key}: ${r.error?.context.status}`);
    record('AI HTTP foreign workspace', key, 'denied before provider');
  }
  const anon = await globalThis.fetch(`${target.url}/functions/v1/generate-children`, {
    method: 'POST',
    headers: { apikey: target.publicKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(anon.status, 401);
  assert.deepEqual(await doc(actors.A, x.id), before);
  const jobs = await service.from('ai_generations').select('id').eq('map_id', x.id);
  assert.equal(jobs.error, null);
  assert.equal(jobs.data.length, 0);
});
test('two simultaneous revisions commit once; changed replay and cross-map parent leave document unchanged', async () => {
  const before = await doc(actors.B, x.id),
    session = uuid(),
    ops = [uuid(), uuid()],
    payloads = [0, 1].map((i) => ({ nodeId: uuid(), parentId: x.root, text: `Filho ${i}` }));
  const results = await Promise.all(
    payloads.map((payload, i) => command(actors.B, x.id, before.map.revision, 'add_child', payload, ops[i], session)),
  );
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(results.filter((r) => r.error?.message === 'CONFLICT').length, 1);
  const i = results.findIndex((r) => !r.error),
    committed = await doc(actors.B, x.id);
  assert.equal(committed.map.revision, before.map.revision + 1);
  assert.equal(committed.nodes.length, 2);
  assert.equal(
    (await command(actors.B, x.id, before.map.revision, 'add_child', payloads[i], ops[i], session)).error,
    null,
  );
  assert.equal(
    (
      await command(
        actors.B,
        x.id,
        before.map.revision,
        'add_child',
        { ...payloads[i], text: 'outro' },
        ops[i],
        session,
      )
    ).error?.message,
    'CONFLICT',
  );
  assert.equal(
    (
      await command(actors.B, x.id, committed.map.revision, 'add_child', {
        nodeId: uuid(),
        parentId: y.root,
        text: 'cross-map',
      })
    ).error?.message,
    'VALIDATION',
  );
  assert.deepEqual(await doc(actors.B, x.id), committed);
  record('revision race, replay, cross-map parent', 'B', 'atomic');
});
test('revoked old JWT and trusted late worker cannot mutate; deleted maps reveal no historical content', async () => {
  let head = await doc(actors.B, x.id);
  assert.equal(
    (await command(actors.B, x.id, head.map.revision, 'transfer_owner', { ownerId: accounts.A.id })).error,
    null,
  );
  head = await doc(actors.A, x.id);
  const generation = uuid();
  assert.equal(
    (
      await rpc(service, 'reserve_ai_generation', {
        p_actor: accounts.B.id,
        p_map_id: x.id,
        p_parent_node_id: x.root,
        p_generation_id: generation,
        p_editor_session_id: uuid(),
        p_guidance: '',
        p_model: 'security-no-provider',
        p_daily_budget: 50000,
      })
    ).claimed,
    true,
  );
  const token = (await actors.B.auth.getSession()).data.session.access_token;
  assert.equal(
    (
      await rpc(actors.A, 'set_member_access', {
        p_workspace: x.workspace,
        p_user: accounts.B.id,
        p_status: 'inactive',
      })
    ).status,
    'inactive',
  );
  assert.equal((await actors.B.auth.getSession()).data.session.access_token, token);
  assert.equal(await doc(actors.B, x.id), null);
  assert.ok((await command(actors.B, x.id, head.map.revision, 'edit_text', { nodeId: x.root, text: 'old JWT' })).error);
  const finished = await rpc(service, 'finish_ai_generation', {
    p_generation_id: generation,
    p_children: [{ text: 'um' }, { text: 'dois' }, { text: 'três' }, { text: 'quatro' }],
    p_usage: null,
    p_error: null,
  });
  assert.equal(finished.state, 'stale');
  assert.deepEqual(await doc(actors.A, x.id), head);
  assert.ok(
    (
      await actors.B.rpc('get_ai_generation', {
        p_map_id: x.id,
        p_generation_id: generation,
        p_editor_session_id: uuid(),
      })
    ).error,
  );
  assert.equal((await command(actors.A, x.id, head.map.revision, 'delete_map', {})).error, null);
  for (const [key, client] of Object.entries(actors))
    for (const [table, col] of [
      ['maps', 'id'],
      ['nodes', 'map_id'],
      ['map_user_preferences', 'map_id'],
    ]) {
      const r = await client.from(table).select('*').eq(col, x.id);
      assert.ok(r.error || r.data.length === 0);
      record(`deleted ${table}`, key, 'unreadable');
    }
  record('old JWT and late worker', 'B', 'denied without content mutation');
});
