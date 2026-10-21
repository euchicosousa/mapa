import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { cleanupRun, createRun, readTarget, trackUser } from '../../scripts/validation-run.mjs';

// Runs against the final project with temporary identities of this run only.
// It fails rather than skipping when the target or credentials are missing.
const target = readTarget();
const run = await createRun(target);
let cleaned = false;
const cleanup = async () => {
  if (!cleaned) {
    cleaned = true;
    await cleanupRun(target, run.runId);
  }
};
after(cleanup);

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(target.url, target.secretKey, options);
const anon = createClient(target.url, target.publicKey, options);
const clients = [];
try {
  for (const account of run.accounts) {
    const client = createClient(target.url, target.publicKey, options);
    const result = await client.auth.signInWithPassword({ email: account.email, password: account.password });
    assert.equal(result.error, null, `Login real da conta temporária ${account.key} falhou`);
    clients.push(client);
  }
} catch (error) {
  await cleanup();
  throw error;
}
const [a, b, c, d] = clients;
const ids = run.accounts.map((account) => account.id);
const workspaceX = run.workspaces.X.id;
const workspaceY = run.workspaces.Y.id;

test('A/B see only X, C only Y and D has no active membership', async () => {
  const expected = [[workspaceX], [workspaceX], [workspaceY], []];
  for (const [index, client] of clients.entries()) {
    const result = await client.from('workspaces').select('id');
    assert.equal(result.error, null);
    assert.deepEqual(
      result.data.map((row) => row.id),
      expected[index],
    );
  }
});
test('anon reads nothing at all', async () => {
  for (const table of ['workspaces', 'workspace_members', 'profiles']) {
    const result = await anon.from(table).select('*').limit(1);
    assert.ok(result.error || result.data.length === 0, `anon leu ${table}`);
  }
});
test('anon, D and C cannot read X membership or private profiles', async () => {
  for (const client of [anon, c, d]) {
    const members = await client.from('workspace_members').select('*').eq('workspace_id', workspaceX);
    assert.ok(members.error || members.data.length === 0);
    const profiles = await client.from('profiles').select('id').in('id', ids.slice(0, 2));
    assert.ok(profiles.error || profiles.data.length === 0);
  }
  const profiles = await a.from('profiles').select('id').in('id', ids.slice(0, 2));
  assert.equal(profiles.error, null);
  assert.equal(profiles.data.length, 2);
});
test('metadata cannot grant role or membership; direct writes are forbidden', async () => {
  const changed = await b.auth.updateUser({ data: { role: 'admin', workspace_id: workspaceY } });
  assert.equal(changed.error, null);
  const result = await b.from('workspace_members').select('role').eq('user_id', ids[1]);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ role: 'member' }]);
  const write = await b.from('workspace_members').update({ role: 'admin' }).eq('user_id', ids[1]);
  assert.ok(write.error);
  const insert = await d.from('workspace_members').insert({ workspace_id: workspaceX, user_id: ids[3], role: 'admin' });
  assert.ok(insert.error);
  const forged = await d.auth.updateUser({ data: { role: 'admin', workspace_id: workspaceX } });
  assert.equal(forged.error, null);
  const denied = await d.from('workspace_members').select('*');
  assert.equal(denied.error, null);
  assert.equal(denied.data.length, 0);
});
test('deactivation revokes reads immediately while colleagues retain historical identity', async () => {
  const changed = await admin
    .from('workspace_members')
    .update({ status: 'inactive' })
    .eq('workspace_id', workspaceX)
    .eq('user_id', ids[1]);
  assert.equal(changed.error, null);
  try {
    const denied = await b.from('workspace_members').select('*');
    assert.equal(denied.error, null);
    assert.equal(denied.data.length, 0);
    const historical = await a.from('profiles').select('id').eq('id', ids[1]);
    assert.equal(historical.error, null);
    assert.equal(historical.data.length, 1);
  } finally {
    const restored = await admin
      .from('workspace_members')
      .update({ status: 'active' })
      .eq('workspace_id', workspaceX)
      .eq('user_id', ids[1]);
    assert.equal(restored.error, null);
  }
});
test('public signup is disabled by real Auth configuration', async () => {
  const result = await anon.auth.signUp({
    email: `mapa-validacao-${run.runId}-signup@example.com`,
    password: `${run.runId}-${randomUUID()}`,
  });
  // If signup were open, the identity must still be removed with this run.
  if (result.data.user) await trackUser(run.runId, result.data.user.id);
  assert.equal(result.error?.code, 'signup_disabled');
  assert.equal(result.data.user, null);
});
test('session refresh keeps the verified identity and real workspace scope', async () => {
  const result = await a.auth.refreshSession();
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, ids[0]);
  const workspace = await a.from('workspaces').select('id');
  assert.equal(workspace.error, null);
  assert.deepEqual(workspace.data, [{ id: workspaceX }]);
});

// Ticket 05: maps, root integrity and the write boundary.
const created = {};
const createMap = (client, operationId, title) =>
  client.rpc('create_map', {
    p_workspace_id: workspaceX,
    p_operation_id: operationId,
    p_editor_session_id: randomUUID(),
    ...(title ? { p_title: title } : {}),
  });
test('B creates a map in X, owns it, and A opens the same document', async () => {
  created.operationId = randomUUID();
  const result = await createMap(b, created.operationId);
  assert.equal(result.error, null);
  assert.equal(result.data.revision, 1);
  created.mapId = result.data.mapId;
  const document = await a.rpc('get_map_document', { p_map_id: created.mapId });
  assert.equal(document.error, null);
  assert.equal(document.data.map.title, 'Novo mapa');
  assert.equal(document.data.map.ownerId, ids[1]);
  assert.equal(document.data.map.revision, 1);
  assert.equal(document.data.nodes.length, 1);
  assert.deepEqual(
    [
      document.data.nodes[0].parentId,
      document.data.nodes[0].text,
      document.data.nodes[0].createdBy,
      document.data.nodes[0].source,
    ],
    [null, 'Ideia central', ids[1], 'manual'],
  );
});
test('repeating the operation id is idempotent; reuse with other content or actor conflicts', async () => {
  const again = await createMap(b, created.operationId);
  assert.equal(again.error, null);
  assert.equal(again.data.mapId, created.mapId);
  const maps = await admin.from('maps').select('id').eq('workspace_id', workspaceX);
  assert.equal(maps.error, null);
  assert.equal(maps.data.length, 1);
  const changed = await createMap(b, created.operationId, 'Outro título');
  assert.equal(changed.error?.message, 'CONFLICT');
  const otherActor = await createMap(a, created.operationId);
  assert.equal(otherActor.error?.message, 'CONFLICT');
});
test('C and D neither read nor create maps in X; anon cannot call the RPCs', async () => {
  for (const client of [c, d]) {
    const document = await client.rpc('get_map_document', { p_map_id: created.mapId });
    assert.equal(document.error, null);
    assert.equal(document.data, null);
    const maps = await client.from('maps').select('id').eq('id', created.mapId);
    assert.equal(maps.error, null);
    assert.equal(maps.data.length, 0);
    const nodes = await client.from('nodes').select('id').eq('map_id', created.mapId);
    assert.equal(nodes.error, null);
    assert.equal(nodes.data.length, 0);
    const forbidden = await createMap(client, randomUUID());
    assert.equal(forbidden.error?.message, 'FORBIDDEN');
  }
  assert.ok((await createMap(anon, randomUUID())).error);
  assert.ok((await anon.rpc('get_map_document', { p_map_id: created.mapId })).error);
});
test('direct client writes and operation log reads are denied', async () => {
  assert.ok(
    (
      await b.from('maps').insert({
        workspace_id: workspaceX,
        title: 'Forjado',
        owner_id: ids[0],
        created_by: ids[0],
        updated_by: ids[0],
      })
    ).error,
  );
  assert.ok((await b.from('maps').update({ owner_id: ids[0] }).eq('id', created.mapId)).error);
  assert.ok(
    (await b.from('nodes').insert({ map_id: created.mapId, text: 'Forjado', created_by: ids[0], updated_by: ids[0] }))
      .error,
  );
  const log = await b.from('map_operations').select('id');
  assert.ok(log.error || log.data.length === 0);
});
test('every map keeps exactly one root, even for privileged writes', async () => {
  const rootless = await admin
    .from('maps')
    .insert({ workspace_id: workspaceX, title: 'Sem raiz', owner_id: ids[1], created_by: ids[1], updated_by: ids[1] })
    .select('id');
  assert.ok(rootless.error, 'map without root must fail at commit');
  const secondRoot = await admin
    .from('nodes')
    .insert({ map_id: created.mapId, parent_id: null, text: 'Outra raiz', created_by: ids[1], updated_by: ids[1] });
  assert.ok(secondRoot.error);
  const removeRoot = await admin.from('nodes').delete().eq('map_id', created.mapId).is('parent_id', null);
  assert.ok(removeRoot.error);
  const maps = await admin.from('maps').select('id').eq('workspace_id', workspaceX);
  assert.deepEqual(
    maps.data.map((row) => row.id),
    [created.mapId],
  );
});
test('library rows carry no node payload', async () => {
  const library = await a
    .from('maps')
    .select('id,title,updated_at,owner:profiles!maps_owner_id_fkey(display_name)')
    .eq('workspace_id', workspaceX);
  assert.equal(library.error, null);
  assert.equal(library.data.length, 1);
  assert.deepEqual(Object.keys(library.data[0]).sort(), ['id', 'owner', 'title', 'updated_at']);
  assert.equal(library.data[0].owner.display_name, run.accounts[1].name);
});

// Ticket 06: add_child/edit_text through the common command, authorship from the session.
const command = (client, kind, payload, expectedRevision, operationId = randomUUID(), mapId = created.mapId) =>
  client.rpc('apply_map_command', {
    p_map_id: mapId,
    p_operation_id: operationId,
    p_editor_session_id: randomUUID(),
    p_expected_revision: expectedRevision,
    p_kind: kind,
    p_payload: payload,
  });
const history = (
  client,
  mode,
  targetOperationId,
  expectedRevision,
  editorSessionId,
  operationId = randomUUID(),
  mapId = created.mapId,
) =>
  client.rpc('apply_map_history', {
    p_map_id: mapId,
    p_operation_id: operationId,
    p_editor_session_id: editorSessionId,
    p_expected_revision: expectedRevision,
    p_mode: mode,
    p_target_operation_id: targetOperationId,
  });
const head = async () => (await a.rpc('get_map_document', { p_map_id: created.mapId })).data;
const tree = {};
test("B adds child and grandchild, A edits B's node: creator stays B, last editor becomes A", async () => {
  const start = await head();
  tree.root = start.nodes[0].id;
  tree.child = randomUUID();
  tree.grandchild = randomUUID();
  const child = await command(
    b,
    'add_child',
    { nodeId: tree.child, parentId: tree.root, text: 'Filho' },
    start.map.revision,
  );
  assert.equal(child.error, null);
  assert.equal(child.data.revision, start.map.revision + 1);
  assert.deepEqual(Object.keys(child.data).sort(), [
    'changedNodes',
    'deletedNodeIds',
    'mapPatch',
    'operationId',
    'revision',
  ]);
  assert.deepEqual(child.data.changedNodes, [
    {
      id: tree.child,
      parentId: tree.root,
      text: 'Filho',
      sortOrder: 0,
      createdBy: ids[1],
      updatedBy: ids[1],
      source: 'manual',
    },
  ]);
  const grandchild = await command(
    b,
    'add_child',
    { nodeId: tree.grandchild, parentId: tree.child, text: 'Neto' },
    child.data.revision,
  );
  assert.equal(grandchild.error, null);
  const edited = await command(
    a,
    'edit_text',
    { nodeId: tree.child, text: 'Filho editado por A' },
    grandchild.data.revision,
  );
  assert.equal(edited.error, null);
  assert.deepEqual([edited.data.changedNodes[0].createdBy, edited.data.changedNodes[0].updatedBy], [ids[1], ids[0]]);

  const reloaded = await head();
  assert.equal(reloaded.map.revision, start.map.revision + 3);
  const byId = Object.fromEntries(reloaded.nodes.map((node) => [node.id, node]));
  assert.deepEqual(
    [byId[tree.child].parentId, byId[tree.child].text, byId[tree.child].createdBy, byId[tree.child].updatedBy],
    [tree.root, 'Filho editado por A', ids[1], ids[0]],
  );
  assert.deepEqual([byId[tree.grandchild].parentId, byId[tree.grandchild].text], [tree.child, 'Neto']);
  assert.equal(reloaded.people[ids[0]], run.accounts[0].name);
  assert.equal(reloaded.people[ids[1]], run.accounts[1].name);
  const log = await admin
    .from('map_operations')
    .select('kind,actor_id,base_revision,result_revision,before_data')
    .eq('id', edited.data.operationId)
    .single();
  assert.equal(log.error, null);
  assert.deepEqual(
    [log.data.kind, log.data.actor_id, log.data.result_revision],
    ['edit_text', ids[0], reloaded.map.revision],
  );
  assert.equal(log.data.before_data.nodes[0].text, 'Filho');
});
test('retry after timeout repeats the result without duplicating; stale or changed requests conflict', async () => {
  const start = await head();
  const operationId = randomUUID();
  const nodeId = randomUUID();
  const payload = { nodeId, parentId: tree.root, text: 'Uma vez só' };
  const first = await command(b, 'add_child', payload, start.map.revision, operationId);
  assert.equal(first.error, null);
  const retry = await command(b, 'add_child', payload, start.map.revision, operationId);
  assert.equal(retry.error, null);
  assert.deepEqual(retry.data, first.data);
  const nodes = await admin.from('nodes').select('id').eq('id', nodeId);
  assert.equal(nodes.data.length, 1);
  assert.equal((await head()).map.revision, start.map.revision + 1);
  assert.equal(
    (await command(b, 'add_child', { ...payload, text: 'Outro' }, start.map.revision, operationId)).error?.message,
    'CONFLICT',
  );
  assert.equal((await command(a, 'add_child', payload, start.map.revision, operationId)).error?.message, 'CONFLICT');
  // Old expectedRevision with a new operation is a conflict, nothing applied.
  const stale = await command(a, 'edit_text', { nodeId, text: 'Sobrescrever' }, start.map.revision);
  assert.equal(stale.error?.message, 'CONFLICT');
  assert.equal((await admin.from('nodes').select('text').eq('id', nodeId).single()).data.text, 'Uma vez só');
  // Siblings get server-computed order.
  assert.equal(first.data.changedNodes[0].sortOrder, 1);
});
test('forged author/source, unknown fields or commands and invalid text are rejected', async () => {
  const { map } = await head();
  const base = { nodeId: randomUUID(), parentId: tree.root, text: 'Forjado' };
  for (const extra of [
    { createdBy: ids[0] },
    { created_by: ids[0] },
    { source: 'ai' },
    { updatedBy: ids[0] },
    { sortOrder: 0 },
  ]) {
    const forged = await command(b, 'add_child', { ...base, ...extra }, map.revision);
    assert.equal(forged.error?.message, 'VALIDATION', JSON.stringify(extra));
  }
  assert.equal(
    (await command(b, 'edit_text', { nodeId: tree.child, text: 'x', source: 'ai' }, map.revision)).error?.message,
    'VALIDATION',
  );
  assert.equal((await command(b, 'set_source', { nodeId: tree.child }, map.revision)).error?.message, 'VALIDATION');
  for (const text of ['', '   ', 'x'.repeat(501), 42]) {
    assert.equal((await command(b, 'add_child', { ...base, text }, map.revision)).error?.message, 'VALIDATION');
    assert.equal(
      (await command(b, 'edit_text', { nodeId: tree.child, text }, map.revision)).error?.message,
      'VALIDATION',
    );
  }
  assert.equal(
    (await command(b, 'add_child', { ...base, nodeId: tree.child }, map.revision)).error?.message,
    'VALIDATION',
    'reused node id',
  );
  assert.equal(
    (await command(b, 'add_child', { ...base, parentId: randomUUID() }, map.revision)).error?.message,
    'VALIDATION',
    'missing parent',
  );
  assert.equal(
    (await command(b, 'add_child', { ...base, nodeId: 'não-é-uuid' }, map.revision)).error?.message,
    'VALIDATION',
  );
  const after = await head();
  assert.equal(after.map.revision, map.revision);
  assert.ok(after.nodes.every((node) => node.source === 'manual'));
  const child = after.nodes.find((node) => node.id === tree.child);
  assert.deepEqual([child.createdBy, child.text], [ids[1], 'Filho editado por A']);
});
test('C, D and anon cannot mutate nodes in X; direct node updates stay denied', async () => {
  const { map } = await head();
  for (const client of [c, d]) {
    const denied = await command(client, 'edit_text', { nodeId: tree.child, text: 'Invasão' }, map.revision);
    assert.equal(denied.error?.message, 'NOT_FOUND');
    assert.equal(
      (await command(client, 'add_child', { nodeId: randomUUID(), parentId: tree.root, text: 'Invasão' }, map.revision))
        .error?.message,
      'NOT_FOUND',
    );
  }
  assert.ok((await command(anon, 'edit_text', { nodeId: tree.child, text: 'Invasão' }, map.revision)).error);
  assert.ok(
    (await b.from('nodes').update({ created_by: ids[1], text: 'Direto' }).eq('id', tree.child).select('id')).data
      ?.length !== 1,
  );
  assert.equal(
    (await admin.from('nodes').select('text,created_by').eq('id', tree.child).single()).data.text,
    'Filho editado por A',
  );
});
test('depth above 30 levels is refused with LIMIT_EXCEEDED', async () => {
  let { map } = await head();
  let parentId = tree.grandchild; // depth 2
  for (let depth = 3; depth <= 30; depth += 1) {
    const nodeId = randomUUID();
    const result = await command(b, 'add_child', { nodeId, parentId, text: `Nível ${depth}` }, map.revision);
    assert.equal(result.error, null, `nível ${depth}`);
    map = { revision: result.data.revision };
    parentId = nodeId;
  }
  const tooDeep = await command(b, 'add_child', { nodeId: randomUUID(), parentId, text: 'Nível 31' }, map.revision);
  assert.equal(tooDeep.error?.message, 'LIMIT_EXCEEDED');
});

test('delete_subtree removes exactly its branch, rejects root and foreign-map ids, and records a trusted replayable snapshot', async () => {
  let { map, nodes: startNodes } = await head();
  const rootId = startNodes.find((node) => node.parentId === null).id;
  const branch = randomUUID();
  const child = randomUUID();
  const grandchild = randomUUID();
  const sibling = randomUUID();
  let result = await command(a, 'add_child', { nodeId: branch, parentId: rootId, text: 'Ramo' }, map.revision);
  assert.equal(result.error, null);
  map.revision = result.data.revision;
  result = await command(a, 'add_child', { nodeId: child, parentId: branch, text: 'Filho' }, map.revision);
  assert.equal(result.error, null);
  map.revision = result.data.revision;
  result = await command(a, 'add_child', { nodeId: grandchild, parentId: child, text: 'Neto' }, map.revision);
  assert.equal(result.error, null);
  map.revision = result.data.revision;
  result = await command(a, 'add_child', { nodeId: sibling, parentId: rootId, text: 'Irmão preservado' }, map.revision);
  assert.equal(result.error, null);
  map.revision = result.data.revision;

  const otherMap = await c.rpc('create_map', {
    p_workspace_id: workspaceY,
    p_operation_id: randomUUID(),
    p_editor_session_id: randomUUID(),
  });
  assert.equal(otherMap.error, null);
  const rootAttempt = await command(a, 'delete_subtree', { nodeId: rootId }, map.revision);
  assert.equal(rootAttempt.error?.message, 'VALIDATION');
  const otherDocument = await c.rpc('get_map_document', { p_map_id: otherMap.data.mapId });
  assert.equal(otherDocument.error, null);
  assert.equal(
    (await command(a, 'delete_subtree', { nodeId: otherDocument.data.nodes[0].id }, map.revision)).error?.message,
    'VALIDATION',
  );
  assert.equal(
    (
      await command(
        a,
        'delete_subtree',
        { nodeId: otherDocument.data.nodes[0].id },
        otherDocument.data.map.revision,
        randomUUID(),
        otherMap.data.mapId,
      )
    ).error?.message,
    'NOT_FOUND',
  );
  assert.equal((await head()).map.revision, map.revision, 'rejected requests do not bump the revision');

  const operationId = randomUUID();
  const payload = { nodeId: branch };
  const deleted = await command(b, 'delete_subtree', payload, map.revision, operationId);
  assert.equal(deleted.error, null);
  assert.equal(deleted.data.revision, map.revision + 1);
  assert.deepEqual(new Set(deleted.data.deletedNodeIds), new Set([branch, child, grandchild]));
  assert.deepEqual(deleted.data.changedNodes, []);
  assert.deepEqual((await command(b, 'delete_subtree', payload, map.revision, operationId)).data, deleted.data);
  const after = await head();
  assert.equal(after.map.revision, map.revision + 1);
  assert.ok(after.nodes.some((node) => node.id === sibling && node.text === 'Irmão preservado'));
  assert.ok(!after.nodes.some((node) => [branch, child, grandchild].includes(node.id)));
  const log = await admin
    .from('map_operations')
    .select('kind,actor_id,base_revision,result_revision,before_data,after_data')
    .eq('id', operationId)
    .single();
  assert.equal(log.error, null);
  assert.deepEqual(
    [log.data.kind, log.data.actor_id, log.data.base_revision, log.data.result_revision],
    ['delete_subtree', ids[1], map.revision, map.revision + 1],
  );
  assert.deepEqual(new Set(log.data.before_data.nodes.map((node) => node.id)), new Set([branch, child, grandchild]));
  assert.ok(log.data.before_data.nodes.every((node) => node.createdBy && node.updatedBy && node.source === 'manual'));
  assert.deepEqual(log.data.after_data, deleted.data);
  assert.equal(
    (await command(a, 'delete_subtree', payload, map.revision + 1)).error?.message,
    'VALIDATION',
    'removed node cannot target another operation',
  );
});

test('undo/redo restores server snapshots, identity and creator through add/edit/delete', async () => {
  const initial = await head();
  const session = randomUUID();
  let revision = initial.map.revision;
  const branch = randomUUID();
  const addOperation = randomUUID();
  const added = await b.rpc('apply_map_command', {
    p_map_id: created.mapId,
    p_operation_id: addOperation,
    p_editor_session_id: session,
    p_expected_revision: revision,
    p_kind: 'add_child',
    p_payload: { nodeId: branch, parentId: tree.root, text: 'Histórico' },
  });
  assert.equal(added.error, null);
  revision = added.data.revision;

  const wrongSession = await history(b, 'undo', addOperation, revision, randomUUID());
  assert.equal(wrongSession.error?.message, 'CONFLICT');
  const wrongActor = await history(a, 'undo', addOperation, revision, session);
  assert.equal(wrongActor.error?.message, 'CONFLICT');

  const undoAddId = randomUUID();
  const undoAdd = await history(b, 'undo', addOperation, revision, session, undoAddId);
  assert.equal(undoAdd.error, null);
  revision = undoAdd.data.revision;
  assert.deepEqual(undoAdd.data.deletedNodeIds, [branch]);
  assert.deepEqual(
    (await history(b, 'undo', addOperation, revision - 1, session, undoAddId)).data,
    undoAdd.data,
    'repeated click replays one inverse',
  );
  assert.equal(
    (await head()).nodes.some((node) => node.id === branch),
    false,
  );

  const redoAdd = await history(b, 'redo', addOperation, revision, session);
  assert.equal(redoAdd.error, null);
  revision = redoAdd.data.revision;
  assert.deepEqual(redoAdd.data.changedNodes[0], added.data.changedNodes[0]);
  const oldRevisionUndo = await history(b, 'undo', addOperation, revision - 1, session);
  assert.equal(oldRevisionUndo.error?.message, 'CONFLICT');

  const authoredByA = randomUUID();
  const addA = await command(
    a,
    'add_child',
    { nodeId: authoredByA, parentId: tree.root, text: 'Criado por A' },
    revision,
  );
  assert.equal(addA.error, null);
  revision = addA.data.revision;
  const editOperation = randomUUID();
  const editB = await b.rpc('apply_map_command', {
    p_map_id: created.mapId,
    p_operation_id: editOperation,
    p_editor_session_id: session,
    p_expected_revision: revision,
    p_kind: 'edit_text',
    p_payload: { nodeId: authoredByA, text: 'Editado por B' },
  });
  assert.equal(editB.error, null);
  revision = editB.data.revision;
  const undoneEdit = await history(b, 'undo', editOperation, revision, session);
  assert.equal(undoneEdit.error, null);
  revision = undoneEdit.data.revision;
  assert.deepEqual(
    [
      undoneEdit.data.changedNodes[0].text,
      undoneEdit.data.changedNodes[0].createdBy,
      undoneEdit.data.changedNodes[0].updatedBy,
    ],
    ['Criado por A', ids[0], ids[0]],
  );
  const redoneEdit = await history(b, 'redo', editOperation, revision, session);
  assert.equal(redoneEdit.error, null);
  revision = redoneEdit.data.revision;
  assert.deepEqual(
    [
      redoneEdit.data.changedNodes[0].text,
      redoneEdit.data.changedNodes[0].createdBy,
      redoneEdit.data.changedNodes[0].updatedBy,
    ],
    ['Editado por B', ids[0], ids[1]],
  );

  const child = randomUUID();
  const addChild = await command(
    a,
    'add_child',
    { nodeId: child, parentId: branch, text: 'Filho preservado' },
    revision,
  );
  assert.equal(addChild.error, null);
  revision = addChild.data.revision;
  const grandchild = randomUUID();
  const addGrandchild = await command(
    a,
    'add_child',
    { nodeId: grandchild, parentId: child, text: 'Neto preservado' },
    revision,
  );
  assert.equal(addGrandchild.error, null);
  revision = addGrandchild.data.revision;
  const savedBranch = (await head()).nodes.filter((node) => [branch, child, grandchild].includes(node.id));
  const deleteOperation = randomUUID();
  const deleted = await b.rpc('apply_map_command', {
    p_map_id: created.mapId,
    p_operation_id: deleteOperation,
    p_editor_session_id: session,
    p_expected_revision: revision,
    p_kind: 'delete_subtree',
    p_payload: { nodeId: branch },
  });
  assert.equal(deleted.error, null);
  revision = deleted.data.revision;
  const restored = await history(b, 'undo', deleteOperation, revision, session);
  assert.equal(restored.error, null);
  revision = restored.data.revision;
  assert.deepEqual(new Set(restored.data.changedNodes.map((node) => node.id)), new Set([branch, child, grandchild]));
  assert.deepEqual(
    [...restored.data.changedNodes].sort((a, b) => a.id.localeCompare(b.id)),
    savedBranch.sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(new Set(restored.data.changedNodes.map((node) => node.createdBy)), new Set([ids[1], ids[0]]));
  const deletedAgain = await history(b, 'redo', deleteOperation, revision, session);
  assert.equal(deletedAgain.error, null);
  revision = deletedAgain.data.revision;
  assert.deepEqual(new Set(deletedAgain.data.deletedNodeIds), new Set([branch, child, grandchild]));
  assert.equal((await head()).map.revision, revision);
});

test('an operation from another editor session invalidates undo at the server head', async () => {
  const start = await head();
  const ownSession = randomUUID();
  const ownOperation = randomUUID();
  const nodeId = randomUUID();
  const own = await b.rpc('apply_map_command', {
    p_map_id: created.mapId,
    p_operation_id: ownOperation,
    p_editor_session_id: ownSession,
    p_expected_revision: start.map.revision,
    p_kind: 'add_child',
    p_payload: { nodeId, parentId: tree.root, text: 'Minha sessão' },
  });
  assert.equal(own.error, null);
  const remote = await command(a, 'edit_text', { nodeId, text: 'Outra sessão' }, own.data.revision);
  assert.equal(remote.error, null);
  const denied = await history(b, 'undo', ownOperation, remote.data.revision, ownSession);
  assert.equal(denied.error?.message, 'CONFLICT');
  const document = await head();
  assert.equal(document.nodes.find((node) => node.id === nodeId).text, 'Outra sessão');
});

test('server history preserves LIFO order across multiple undo and redo actions', async () => {
  const session = randomUUID();
  let revision = (await head()).map.revision;
  const firstNode = randomUUID();
  const secondNode = randomUUID();
  const firstOperation = randomUUID();
  const secondOperation = randomUUID();
  let result = await b.rpc('apply_map_command', {
    p_map_id: created.mapId,
    p_operation_id: firstOperation,
    p_editor_session_id: session,
    p_expected_revision: revision,
    p_kind: 'add_child',
    p_payload: { nodeId: firstNode, parentId: tree.root, text: 'A' },
  });
  assert.equal(result.error, null);
  revision = result.data.revision;
  result = await b.rpc('apply_map_command', {
    p_map_id: created.mapId,
    p_operation_id: secondOperation,
    p_editor_session_id: session,
    p_expected_revision: revision,
    p_kind: 'add_child',
    p_payload: { nodeId: secondNode, parentId: tree.root, text: 'B' },
  });
  assert.equal(result.error, null);
  revision = result.data.revision;
  assert.equal(
    (await history(b, 'undo', firstOperation, revision, session)).error?.message,
    'CONFLICT',
    'older operation is not the stack head',
  );
  result = await history(b, 'undo', secondOperation, revision, session);
  assert.equal(result.error, null);
  revision = result.data.revision;
  result = await history(b, 'undo', firstOperation, revision, session);
  assert.equal(result.error, null);
  revision = result.data.revision;
  result = await history(b, 'redo', firstOperation, revision, session);
  assert.equal(result.error, null);
  revision = result.data.revision;
  result = await history(b, 'redo', secondOperation, revision, session);
  assert.equal(result.error, null);
  revision = result.data.revision;
  const document = await head();
  assert.equal(document.map.revision, revision);
  assert.ok(document.nodes.some((node) => node.id === firstNode && node.text === 'A' && node.createdBy === ids[1]));
  assert.ok(document.nodes.some((node) => node.id === secondNode && node.text === 'B' && node.createdBy === ids[1]));

  result = await history(b, 'undo', secondOperation, revision, session);
  assert.equal(result.error, null);
  revision = result.data.revision;
  const newOperation = randomUUID();
  result = await b.rpc('apply_map_command', {
    p_map_id: created.mapId,
    p_operation_id: newOperation,
    p_editor_session_id: session,
    p_expected_revision: revision,
    p_kind: 'add_child',
    p_payload: { nodeId: randomUUID(), parentId: tree.root, text: 'Nova ação limpa redo' },
  });
  assert.equal(result.error, null);
  revision = result.data.revision;
  result = await history(b, 'undo', newOperation, revision, session);
  assert.equal(result.error, null);
  revision = result.data.revision;
  assert.equal(
    (await history(b, 'redo', secondOperation, revision, session)).error?.message,
    'CONFLICT',
    'discarded redo cannot return after undoing a new action',
  );

  const external = await command(a, 'edit_text', { nodeId: firstNode, text: 'Edição externa preservada' }, revision);
  assert.equal(external.error, null);
  revision = external.data.revision;
  const afterExternal = randomUUID();
  result = await b.rpc('apply_map_command', {
    p_map_id: created.mapId,
    p_operation_id: afterExternal,
    p_editor_session_id: session,
    p_expected_revision: revision,
    p_kind: 'add_child',
    p_payload: { nodeId: randomUUID(), parentId: tree.root, text: 'Depois da alteração externa' },
  });
  assert.equal(result.error, null);
  revision = result.data.revision;
  result = await history(b, 'undo', afterExternal, revision, session);
  assert.equal(result.error, null);
  revision = result.data.revision;
  assert.equal(
    (await history(b, 'undo', firstOperation, revision, session)).error?.message,
    'CONFLICT',
    'new own edits cannot revive history from before another session',
  );
});

test('history replay revalidates membership and concurrent retries commit only one inverse', async () => {
  const session = randomUUID();
  const revision = (await head()).map.revision;
  const operation = randomUUID();
  const nodeId = randomUUID();
  const added = await b.rpc('apply_map_command', {
    p_map_id: created.mapId,
    p_operation_id: operation,
    p_editor_session_id: session,
    p_expected_revision: revision,
    p_kind: 'add_child',
    p_payload: { nodeId, parentId: tree.root, text: 'Uma inversão' },
  });
  assert.equal(added.error, null);
  for (const client of [c, d])
    assert.equal((await history(client, 'undo', operation, added.data.revision, session)).error?.message, 'NOT_FOUND');
  assert.ok((await history(anon, 'undo', operation, added.data.revision, session)).error);
  assert.equal((await history(b, null, operation, added.data.revision, session)).error?.message, 'VALIDATION');
  const inverseId = randomUUID();
  const results = await Promise.all([
    history(b, 'undo', operation, added.data.revision, session, inverseId),
    history(b, 'undo', operation, added.data.revision, session, inverseId),
  ]);
  assert.equal(results[0].error, null);
  assert.equal(results[1].error, null);
  assert.deepEqual(results[0].data, results[1].data);
  assert.equal((await head()).map.revision, added.data.revision + 1);
  const revoked = await admin
    .from('workspace_members')
    .update({ status: 'inactive' })
    .eq('workspace_id', workspaceX)
    .eq('user_id', ids[1]);
  assert.equal(revoked.error, null);
  try {
    assert.equal(
      (await history(b, 'undo', operation, added.data.revision, session, inverseId)).error?.message,
      'NOT_FOUND',
    );
    assert.equal((await history(b, 'redo', operation, added.data.revision + 1, session)).error?.message, 'NOT_FOUND');
  } finally {
    const restored = await admin
      .from('workspace_members')
      .update({ status: 'active' })
      .eq('workspace_id', workspaceX)
      .eq('user_id', ids[1]);
    assert.equal(restored.error, null);
  }
});

// Ticket 08: the same finite copy operation also serves future duplication.
let recoveredCopy;
let copyOperation;
let copyPayload;
test('local recovery copy is atomic, idempotent and assigns fresh ids/authorship to the caller', async () => {
  const document = await head();
  copyOperation = randomUUID();
  copyPayload = {
    p_source_map_id: created.mapId,
    p_operation_id: copyOperation,
    p_editor_session_id: randomUUID(),
    p_title: 'Recuperação local',
    p_nodes: document.nodes.map(({ id, parentId, text, sortOrder }) => ({ id, parentId, text, sortOrder })),
  };
  copyPayload.p_nodes[0].text = 'Versão local preservada';
  const first = await a.rpc('create_map_copy', copyPayload);
  assert.equal(first.error, null);
  recoveredCopy = first.data.mapId;
  assert.notEqual(recoveredCopy, created.mapId);
  const repeat = await a.rpc('create_map_copy', copyPayload);
  assert.deepEqual(repeat.data, first.data);
  assert.equal(repeat.error, null);
  const copy = await a.rpc('get_map_document', { p_map_id: recoveredCopy });
  assert.equal(copy.error, null);
  assert.equal(copy.data.nodes.length, document.nodes.length);
  assert.equal(copy.data.map.ownerId, ids[0]);
  assert.equal(copy.data.map.revision, 1);
  assert.ok(
    copy.data.nodes.every((node) => node.createdBy === ids[0] && node.updatedBy === ids[0] && node.source === 'manual'),
  );
  assert.ok(copy.data.nodes.every((node) => !document.nodes.some((old) => old.id === node.id)));
  assert.equal(copy.data.nodes.find((node) => !node.parentId).text, 'Versão local preservada');
  assert.deepEqual(await head(), document, 'source remains byte-for-byte unchanged');
  assert.equal(
    (await a.rpc('create_map_copy', { ...copyPayload, p_title: 'Outra solicitação' })).error?.message,
    'CONFLICT',
  );
  assert.equal((await b.rpc('create_map_copy', copyPayload)).error?.message, 'CONFLICT');
});
test('recovery copy rejects unauthorized callers and invalid trees without partial maps', async () => {
  const before = (await a.from('maps').select('id').eq('workspace_id', workspaceX)).data;
  for (const client of [c, d])
    assert.equal(
      (await client.rpc('create_map_copy', { ...copyPayload, p_operation_id: randomUUID() })).error?.message,
      'NOT_FOUND',
    );
  assert.ok((await anon.rpc('create_map_copy', copyPayload)).error);
  const root = { id: randomUUID(), parentId: null, text: 'Raiz', sortOrder: 0 };
  const child = { id: randomUUID(), parentId: root.id, text: 'Filho', sortOrder: 0 };
  const invalid = [
    [],
    [root, root],
    [root, { ...child, parentId: randomUUID() }],
    [root, { ...child, parentId: child.id }],
    [root, { ...child, parentId: null }],
    [{ ...root, createdBy: ids[1] }],
    [{ ...root, source: 'ai' }],
    [{ ...root, text: 'x'.repeat(501) }],
    [{ ...root, sortOrder: -1 }],
  ];
  for (const nodes of invalid) {
    const result = await a.rpc('create_map_copy', { ...copyPayload, p_operation_id: randomUUID(), p_nodes: nodes });
    assert.equal(result.error?.message, 'VALIDATION');
  }
  const excessive = Array.from({ length: 501 }, (_, i) =>
    i ? { id: randomUUID(), parentId: root.id, text: 'Filho', sortOrder: i } : root,
  );
  assert.equal(
    (await a.rpc('create_map_copy', { ...copyPayload, p_operation_id: randomUUID(), p_nodes: excessive })).error
      ?.message,
    'LIMIT_EXCEEDED',
  );
  const deep = [root];
  for (let i = 1; i <= 31; i++) deep.push({ id: randomUUID(), parentId: deep[i - 1].id, text: 'Nível', sortOrder: 0 });
  assert.equal(
    (await a.rpc('create_map_copy', { ...copyPayload, p_operation_id: randomUUID(), p_nodes: deep })).error?.message,
    'LIMIT_EXCEEDED',
  );
  assert.deepEqual((await a.from('maps').select('id').eq('workspace_id', workspaceX)).data, before);
});
test('revoked caller cannot create a recovery copy, even by replaying an old request', async () => {
  await admin
    .from('workspace_members')
    .update({ status: 'inactive' })
    .eq('workspace_id', workspaceX)
    .eq('user_id', ids[0]);
  try {
    assert.equal((await a.rpc('create_map_copy', copyPayload)).error?.message, 'NOT_FOUND');
    assert.equal(
      (await a.rpc('create_map_copy', { ...copyPayload, p_operation_id: randomUUID() })).error?.message,
      'NOT_FOUND',
    );
  } finally {
    await admin
      .from('workspace_members')
      .update({ status: 'active' })
      .eq('workspace_id', workspaceX)
      .eq('user_id', ids[0]);
  }
});

// Ticket 11: structural operations share the command log and history boundary.
test('move/reorder normalize both groups atomically, carry mixed-author branches and undo/redo exact snapshots', async () => {
  const made = await createMap(b, randomUUID());
  assert.equal(made.error, null);
  const mapId = made.data.mapId;
  const read = async () => {
    const r = await a.rpc('get_map_document', { p_map_id: mapId });
    assert.equal(r.error, null);
    return r.data;
  };
  let doc = await read();
  const root = doc.nodes[0].id;
  const session = randomUUID();
  const send = async (kind, payload, client = a, operationId = randomUUID(), revision = doc.map.revision) =>
    client.rpc('apply_map_command', {
      p_map_id: mapId,
      p_operation_id: operationId,
      p_editor_session_id: session,
      p_expected_revision: revision,
      p_kind: kind,
      p_payload: payload,
    });
  const add = async (parentId, text, client = b) => {
    const nodeId = randomUUID();
    const r = await send('add_child', { nodeId, parentId, text }, client);
    assert.equal(r.error, null);
    doc = await read();
    return nodeId;
  };
  const left = await add(root, 'left'),
    gap = await add(root, 'gap'),
    branch = await add(root, 'branch'),
    dest = await add(root, 'destination');
  const child = await add(branch, 'child', a),
    grandchild = await add(child, 'grandchild');
  const existing = await add(dest, 'existing');
  assert.equal((await send('delete_subtree', { nodeId: gap })).error, null);
  doc = await read();
  const sorted = (nodes) => [...nodes].sort((x, y) => x.id.localeCompare(y.id));
  const before = sorted(doc.nodes);
  const moveId = randomUUID();
  const rev = doc.map.revision;
  const payload = { nodeId: branch, newParentId: dest, targetIndex: 0 };
  const moved = await send('move_subtree', payload, a, moveId);
  assert.equal(moved.error, null);
  assert.equal(moved.data.revision, rev + 1);
  assert.deepEqual(moved.data.deletedNodeIds, []);
  assert.deepEqual((await send('move_subtree', payload, a, moveId, rev)).data, moved.data);
  assert.equal((await send('move_subtree', { ...payload, targetIndex: 1 }, a, moveId, rev)).error?.message, 'CONFLICT');
  doc = await read();
  const after = sorted(doc.nodes);
  const node = (id) => doc.nodes.find((n) => n.id === id);
  assert.deepEqual(
    [node(branch).parentId, node(branch).sortOrder, node(branch).createdBy, node(branch).updatedBy],
    [dest, 0, ids[1], ids[0]],
  );
  assert.deepEqual([node(left).sortOrder, node(dest).sortOrder, node(existing).sortOrder], [0, 1, 1]);
  for (const id of [child, grandchild])
    assert.deepEqual(
      node(id),
      before.find((n) => n.id === id),
    );
  const inverse = async (mode, id) => {
    const r = await history(a, mode, id, doc.map.revision, session, randomUUID(), mapId);
    assert.equal(r.error, null);
    doc = await read();
  };
  await inverse('undo', moveId);
  assert.deepEqual(sorted(doc.nodes), before);
  await inverse('redo', moveId);
  assert.deepEqual(sorted(doc.nodes), after);
  const reorderId = randomUUID();
  const reordered = await send('reorder_siblings', { nodeId: branch, targetIndex: 1 }, a, reorderId);
  assert.equal(reordered.error, null);
  doc = await read();
  assert.deepEqual([node(branch).sortOrder, node(existing).sortOrder], [1, 0]);
  const reorderedNodes = sorted(doc.nodes);
  await inverse('undo', reorderId);
  assert.deepEqual(sorted(doc.nodes), after);
  await inverse('undo', moveId);
  assert.deepEqual(sorted(doc.nodes), before);
  await inverse('redo', moveId);
  await inverse('redo', reorderId);
  assert.deepEqual(sorted(doc.nodes), reorderedNodes);
  // The same-parent move has the same final-index semantics and does not lose siblings.
  const sameId = randomUUID();
  assert.equal(
    (await send('move_subtree', { nodeId: branch, newParentId: dest, targetIndex: 0 }, a, sameId)).error,
    null,
  );
  doc = await read();
  assert.deepEqual([node(branch).sortOrder, node(existing).sortOrder], [0, 1]);
  await inverse('undo', sameId);
  assert.deepEqual(sorted(doc.nodes), reorderedNodes);
});

test('structural root/cycle/foreign/depth/index/authorization failures leave nodes, revision and log unchanged', async () => {
  const made = await createMap(a, randomUUID());
  assert.equal(made.error, null);
  const mapId = made.data.mapId,
    session = randomUUID();
  const read = async () => {
    const r = await a.rpc('get_map_document', { p_map_id: mapId });
    assert.equal(r.error, null);
    return r.data;
  };
  let doc = await read();
  const root = doc.nodes[0].id;
  const send = (kind, payload, client = a, revision = doc.map.revision) =>
    client.rpc('apply_map_command', {
      p_map_id: mapId,
      p_operation_id: randomUUID(),
      p_editor_session_id: session,
      p_expected_revision: revision,
      p_kind: kind,
      p_payload: payload,
    });
  const add = async (parentId) => {
    const nodeId = randomUUID();
    const r = await send('add_child', { nodeId, parentId, text: 'level' });
    assert.equal(r.error, null);
    doc = await read();
    return nodeId;
  };
  const branch = await add(root),
    child = await add(branch);
  let deepest = root;
  const chain = [root];
  for (let i = 1; i <= 30; i++) {
    deepest = await add(deepest);
    chain.push(deepest);
  }
  const other = await createMap(a, randomUUID());
  assert.equal(other.error, null);
  const foreign = (await a.rpc('get_map_document', { p_map_id: other.data.mapId })).data.nodes[0].id;
  const log = async () => {
    const r = await admin.from('map_operations').select('id').eq('map_id', mapId).order('id');
    assert.equal(r.error, null);
    return r.data;
  };
  const original = await read(),
    originalLog = await log();
  const cases = [
    ['move_subtree', { nodeId: root, newParentId: branch, targetIndex: 0 }, 'VALIDATION'],
    ['reorder_siblings', { nodeId: root, targetIndex: 0 }, 'VALIDATION'],
    ['move_subtree', { nodeId: branch, newParentId: branch, targetIndex: 0 }, 'VALIDATION'],
    ['move_subtree', { nodeId: branch, newParentId: child, targetIndex: 0 }, 'VALIDATION'],
    ['move_subtree', { nodeId: branch, newParentId: foreign, targetIndex: 0 }, 'VALIDATION'],
    ['move_subtree', { nodeId: foreign, newParentId: root, targetIndex: 0 }, 'VALIDATION'],
    ['move_subtree', { nodeId: branch, newParentId: chain[29], targetIndex: 0 }, 'LIMIT_EXCEEDED'],
    ['move_subtree', { nodeId: branch, newParentId: deepest, targetIndex: 0 }, 'LIMIT_EXCEEDED'],
    ...[-1, 0.5, 99, '0', null, 1000000000000].map((targetIndex) => [
      'reorder_siblings',
      { nodeId: branch, targetIndex },
      'VALIDATION',
    ]),
    ['move_subtree', { nodeId: branch, newParentId: root, targetIndex: 0, createdBy: ids[2] }, 'VALIDATION'],
  ];
  for (const [kind, payload, code] of cases) {
    const r = await send(kind, payload);
    assert.equal(r.error?.message, code, JSON.stringify({ kind, payload, error: r.error }));
    assert.deepEqual(await read(), original);
    assert.deepEqual(await log(), originalLog);
  }
  for (const client of [c, d])
    for (const kind of ['move_subtree', 'reorder_siblings']) {
      const r = await send(
        kind,
        { nodeId: branch, targetIndex: 0, ...(kind === 'move_subtree' ? { newParentId: root } : {}) },
        client,
      );
      assert.equal(r.error?.message, 'NOT_FOUND');
    }
  assert.ok((await send('move_subtree', { nodeId: branch, newParentId: root, targetIndex: 0 }, anon)).error);
  assert.deepEqual(await read(), original);
  assert.deepEqual(await log(), originalLog);
  // Deepest descendant, not just the moved node, determines the permitted destination.
  assert.equal((await send('move_subtree', { nodeId: branch, newParentId: chain[28], targetIndex: 0 })).error, null);
  doc = await read();
  assert.equal(doc.nodes.find((n) => n.id === child).parentId, branch);
});

// Ticket 12: personal preferences are RLS-protected, outside content/history.
const preferenceMap = {};
test('A/B keep independent personal views without changing map revision, authors or operation log', async () => {
  const made = await createMap(a, randomUUID());
  assert.equal(made.error, null);
  preferenceMap.id = made.data.mapId;
  const read = () => a.rpc('get_map_document', { p_map_id: preferenceMap.id });
  const before = (await read()).data;
  preferenceMap.root = before.nodes[0].id;
  const logBefore = await admin.from('map_operations').select('id').eq('map_id', preferenceMap.id);
  const views = [
    {
      map_id: preferenceMap.id,
      user_id: ids[0],
      viewport: { x: 32, y: -40, zoom: 0.5 },
      collapsed_node_ids: [preferenceMap.root],
    },
    { map_id: preferenceMap.id, user_id: ids[1], viewport: { x: -50, y: 60, zoom: 1.5 }, collapsed_node_ids: [] },
  ];
  for (const [i, client] of [a, b].entries()) {
    const r = await client.from('map_user_preferences').upsert(views[i]);
    assert.equal(r.error, null);
    const own = await client.from('map_user_preferences').select('*').eq('map_id', preferenceMap.id);
    assert.equal(own.error, null);
    assert.deepEqual(own.data, [views[i]]);
  }
  const concurrent = await Promise.all([
    a
      .from('map_user_preferences')
      .update({ viewport: { x: 12, y: 13, zoom: 1 } })
      .eq('map_id', preferenceMap.id),
    b
      .from('map_user_preferences')
      .update({ collapsed_node_ids: [preferenceMap.root] })
      .eq('map_id', preferenceMap.id),
  ]);
  for (const r of concurrent) assert.equal(r.error, null);
  assert.deepEqual((await read()).data, before);
  assert.deepEqual(
    (await admin.from('map_operations').select('id').eq('map_id', preferenceMap.id)).data,
    logBefore.data,
  );
});
test('preferences reject foreign user/map writes, invalid shapes, anon and revoked membership atomically', async () => {
  const table = 'map_user_preferences',
    mapId = preferenceMap.id;
  const row = { map_id: mapId, user_id: ids[0], viewport: { x: 0, y: 0, zoom: 1 }, collapsed_node_ids: [] };
  const readAll = async () => {
    const r = await admin.from(table).select('*').eq('map_id', mapId).order('user_id');
    assert.equal(r.error, null);
    return r.data;
  };
  const before = await readAll();
  for (const client of [b, c, d, anon]) assert.ok((await client.from(table).upsert(row)).error);
  for (const client of [c, d, anon]) {
    const r = await client.from(table).select('*').eq('map_id', mapId);
    assert.ok(r.error || r.data.length === 0);
  }
  const attack = await b
    .from(table)
    .update({ viewport: { x: 99, y: 99, zoom: 2 } })
    .eq('map_id', mapId)
    .eq('user_id', ids[0])
    .select();
  assert.ok(attack.error || attack.data.length === 0);
  const reassign = await a.from(table).update({ user_id: ids[1] }).eq('map_id', mapId).eq('user_id', ids[0]);
  assert.ok(reassign.error);
  const remove = await b.from(table).delete().eq('map_id', mapId).eq('user_id', ids[0]).select();
  assert.ok(remove.error || remove.data.length === 0);
  for (const viewport of [
    null,
    [],
    {},
    { x: 0, y: 0, zoom: 0 },
    { x: 0, y: 0, zoom: 2.1 },
    { x: '0', y: 0, zoom: 1 },
    { x: 0, y: 0, zoom: 1, extra: true },
    { x: 1e10, y: 0, zoom: 1 },
  ])
    assert.ok((await a.from(table).upsert({ ...row, viewport })).error, JSON.stringify(viewport));
  for (const collapsed_node_ids of [null, [null], Array.from({ length: 501 }, () => randomUUID())])
    assert.ok((await a.from(table).upsert({ ...row, collapsed_node_ids })).error);
  assert.deepEqual(await readAll(), before);
  const otherMap = await c.rpc('create_map', {
    p_workspace_id: workspaceY,
    p_operation_id: randomUUID(),
    p_editor_session_id: randomUUID(),
  });
  assert.equal(otherMap.error, null);
  assert.ok((await a.from(table).upsert({ ...row, map_id: otherMap.data.mapId })).error);
  await admin
    .from('workspace_members')
    .update({ status: 'inactive' })
    .eq('workspace_id', workspaceX)
    .eq('user_id', ids[0]);
  try {
    const r = await a.from(table).select('*').eq('map_id', mapId);
    assert.equal(r.error, null);
    assert.deepEqual(r.data, []);
    assert.ok((await a.from(table).upsert(row)).error);
  } finally {
    await admin
      .from('workspace_members')
      .update({ status: 'active' })
      .eq('workspace_id', workspaceX)
      .eq('user_id', ids[0]);
  }
  await admin.from('maps').update({ deleted_at: new Date().toISOString() }).eq('id', mapId);
  try {
    const r = await a.from(table).select('*').eq('map_id', mapId);
    assert.equal(r.error, null);
    assert.deepEqual(r.data, []);
    assert.ok((await a.from(table).upsert(row)).error);
  } finally {
    await admin.from('maps').update({ deleted_at: null }).eq('id', mapId);
  }
  assert.deepEqual(await readAll(), before);
});

// Ticket 13: project authorization, versioned metadata and bounded library reads.
const projectX = randomUUID(),
  projectY = randomUUID();
const projectArgs = {
  p_project_id: projectX,
  p_workspace_id: workspaceX,
  p_name: 'Projeto X',
  p_client_name: 'Cliente X',
};
test('projects are scoped, creation retries are idempotent and active colleagues may rename', async () => {
  const made = await b.rpc('create_project', projectArgs);
  assert.equal(made.error, null);
  assert.deepEqual((await b.rpc('create_project', projectArgs)).data, made.data);
  assert.equal((await a.rpc('create_project', projectArgs)).error?.message, 'CONFLICT');
  assert.equal((await b.rpc('create_project', { ...projectArgs, p_name: 'Outro' })).error?.message, 'CONFLICT');
  assert.equal(
    (await c.rpc('create_project', { ...projectArgs, p_project_id: randomUUID() })).error?.message,
    'FORBIDDEN',
  );
  assert.equal(
    (await c.rpc('create_project', { p_project_id: projectY, p_workspace_id: workspaceY, p_name: 'Projeto Y' })).error,
    null,
  );
  for (const client of [c, d, anon]) {
    const r = await client.from('projects').select('id').eq('id', projectX);
    assert.ok(r.error || r.data.length === 0);
    assert.ok((await client.rpc('rename_project', { p_project_id: projectX, p_name: 'Ataque' })).error);
  }
  assert.ok((await anon.rpc('create_project', projectArgs)).error);
  for (const name of ['', '   ', 'x'.repeat(121)])
    assert.equal(
      (await b.rpc('create_project', { ...projectArgs, p_project_id: randomUUID(), p_name: name })).error?.message,
      'VALIDATION',
    );
  for (const mutate of [
    () => b.from('projects').update({ created_by: ids[0] }).eq('id', projectX),
    () => b.from('projects').delete().eq('id', projectX),
    () =>
      b.from('projects').insert({
        id: randomUUID(),
        workspace_id: workspaceX,
        name: 'Forjado',
        created_by: ids[1],
        creation_hash: 'x',
      }),
  ])
    assert.ok((await mutate()).error);
  const renamed = await a.rpc('rename_project', { p_project_id: projectX, p_name: 'Projeto renomeado' });
  assert.equal(renamed.error, null);
  assert.equal(renamed.data.clientName, null);
  assert.equal((await b.rpc('create_project', projectArgs)).data.name, 'Projeto renomeado');
  const row = await admin.from('projects').select('created_by').eq('id', projectX).single();
  assert.equal(row.data.created_by, ids[1]);
  await admin
    .from('workspace_members')
    .update({ status: 'inactive' })
    .eq('workspace_id', workspaceX)
    .eq('user_id', ids[1]);
  try {
    assert.equal(
      (await b.rpc('create_project', { ...projectArgs, p_project_id: randomUUID() })).error?.message,
      'FORBIDDEN',
    );
    assert.equal(
      (await b.rpc('rename_project', { p_project_id: projectX, p_name: 'Revogado' })).error?.message,
      'NOT_FOUND',
    );
    assert.deepEqual((await b.from('projects').select('id')).data, []);
  } finally {
    await admin
      .from('workspace_members')
      .update({ status: 'active' })
      .eq('workspace_id', workspaceX)
      .eq('user_id', ids[1]);
  }
});
test('rename and project association increment revision once, replay and undo/redo without touching nodes', async () => {
  const made = await createMap(b, randomUUID(), 'Original');
  assert.equal(made.error, null);
  const mapId = made.data.mapId,
    session = randomUUID();
  const read = async () => {
    const r = await b.rpc('get_map_document', { p_map_id: mapId });
    assert.equal(r.error, null);
    return r.data;
  };
  const before = await read();
  let revision = before.map.revision;
  const send = (kind, payload, operation = randomUUID(), expected = revision, client = b) =>
    client.rpc('apply_map_command', {
      p_map_id: mapId,
      p_operation_id: operation,
      p_editor_session_id: session,
      p_expected_revision: expected,
      p_kind: kind,
      p_payload: payload,
    });
  for (const [kind, payload] of [
    ['rename_map', { title: 'Título novo' }],
    ['set_project', { projectId: projectX }],
    ['set_project', { projectId: null }],
  ]) {
    const operation = randomUUID(),
      old = revision,
      prior = (await read()).map;
    const r = await send(kind, payload, operation);
    assert.equal(r.error, null);
    revision++;
    assert.equal(r.data.revision, revision);
    assert.deepEqual(r.data.changedNodes, []);
    assert.deepEqual((await send(kind, payload, operation, old)).data, r.data);
    assert.deepEqual((await read()).nodes, before.nodes);
    const undone = await history(b, 'undo', operation, revision, session, randomUUID(), mapId);
    assert.equal(undone.error, null);
    revision++;
    assert.equal(
      (await read()).map[kind === 'rename_map' ? 'title' : 'projectId'],
      prior[kind === 'rename_map' ? 'title' : 'projectId'],
    );
    const redone = await history(b, 'redo', operation, revision, session, randomUUID(), mapId);
    assert.equal(redone.error, null);
    revision++;
    assert.equal(
      (await read()).map[kind === 'rename_map' ? 'title' : 'projectId'],
      kind === 'rename_map' ? payload.title : payload.projectId,
    );
  }
  const snapshot = await read();
  for (const [kind, payload] of [
    ['rename_map', { title: '' }],
    ['rename_map', { title: 'x'.repeat(121) }],
    ['rename_map', { title: 'Valid', extra: 1 }],
    ['set_project', { projectId: projectY }],
    ['set_project', { projectId: 'invalid' }],
    ['set_project', {}],
  ])
    assert.equal((await send(kind, payload)).error?.message, 'VALIDATION');
  assert.equal((await send('rename_map', { title: 'Stale' }, randomUUID(), revision - 1)).error?.message, 'CONFLICT');
  for (const client of [a, c, d, anon]) {
    if (client === a) continue;
    assert.ok((await send('set_project', { projectId: projectX }, randomUUID(), revision, client)).error);
  }
  const foreignFK = await admin.from('maps').update({ project_id: projectY }).eq('id', mapId);
  assert.ok(foreignFK.error);
  assert.deepEqual(await read(), snapshot);
  assert.deepEqual(snapshot.nodes, before.nodes);
  assert.equal(snapshot.map.ownerId, before.map.ownerId);
});
test('45 tied maps paginate 20/20/5 deterministically; server search and filters expose metadata only', async () => {
  const prefix = `Biblioteca-${run.runId}`,
    maps = [];
  for (let i = 0; i < 45; i++) {
    const r = await createMap(
      i % 2 ? a : b,
      randomUUID(),
      `${prefix} ${String(i).padStart(2, '0')}${i === 0 ? ' 100%_literal' : ''}`,
    );
    assert.equal(r.error, null);
    maps.push({ id: r.data.mapId, owner: i % 2 ? ids[0] : ids[1] });
  }
  const foreign = await c.rpc('create_map', {
    p_workspace_id: workspaceY,
    p_operation_id: randomUUID(),
    p_editor_session_id: randomUUID(),
    p_title: prefix,
  });
  assert.equal(foreign.error, null);
  assert.equal(
    (
      await admin
        .from('maps')
        .update({ updated_at: '2026-01-01T00:00:00Z' })
        .in(
          'id',
          maps.map((m) => m.id),
        )
    ).error,
    null,
  );
  assert.equal(
    (
      await admin
        .from('maps')
        .update({ project_id: projectX })
        .in(
          'id',
          maps.slice(0, 10).map((m) => m.id),
        )
    ).error,
    null,
  );
  const query = async (patch = {}, client = b) => {
    const r = await client.rpc('list_map_library', { p_workspace_id: workspaceX, p_query: prefix, ...patch });
    assert.equal(r.error, null);
    return r.data;
  };
  const pages = await Promise.all([1, 2, 3].map((p) => query({ p_page: p })));
  assert.deepEqual(
    pages.map((p) => p.items.length),
    [20, 20, 5],
  );
  const ordered = pages.flatMap((p) => p.items.map((m) => m.id));
  assert.deepEqual(
    ordered,
    maps
      .map((m) => m.id)
      .sort()
      .reverse(),
  );
  assert.equal(new Set(ordered).size, 45);
  assert.deepEqual(await query({ p_page: 2 }), pages[1]);
  assert.equal((await query({ p_page: 2147483647 })).page, 3);
  for (const p of pages) {
    assert.equal(p.total, 45);
    assert.equal(p.pageSize, 20);
    for (const item of p.items)
      assert.deepEqual(
        Object.keys(item).sort(),
        [
          'id',
          'title',
          'projectId',
          'projectName',
          'clientName',
          'ownerId',
          'ownerName',
          'updatedAt',
          'revision',
        ].sort(),
      );
  }
  assert.equal((await query({ p_query: prefix.toUpperCase() })).total, 45);
  assert.equal((await query({ p_query: '100%_literal' })).total, 1);
  assert.equal((await query({ p_project_id: projectX })).total, 10);
  assert.equal((await query({ p_owner_id: ids[0] })).total, 22);
  assert.equal((await query({ p_project_id: projectX, p_owner_id: ids[0] })).total, 5);
  assert.equal((await query({ p_without_project: true })).total, 35);
  assert.equal((await query({ p_query: 'inexistente-' + prefix })).total, 0);
  assert.deepEqual((await query({}, a)).items, pages[0].items);
  for (const client of [c, d, anon])
    assert.ok((await client.rpc('list_map_library', { p_workspace_id: workspaceX })).error);
  assert.equal((await b.rpc('list_map_library', { p_workspace_id: workspaceY })).error?.message, 'FORBIDDEN');
  for (const patch of [
    { p_page: 0 },
    { p_query: 'x'.repeat(121) },
    { p_project_id: projectX, p_without_project: true },
  ])
    assert.equal(
      (await b.rpc('list_map_library', { p_workspace_id: workspaceX, ...patch })).error?.message,
      'VALIDATION',
    );
});

// Ticket 14: responsibility is independent of collaborative editing and authorship.
const ownership = {};
test('owner B transfers to A once, preserves historical creators and cannot reclaim via undo or direct writes', async () => {
  const made = await createMap(b, randomUUID(), 'Responsabilidade da equipe');
  assert.equal(made.error, null);
  ownership.id = made.data.mapId;
  ownership.session = randomUUID();
  const read = async () => {
    const r = await b.rpc('get_map_document', { p_map_id: ownership.id });
    assert.equal(r.error, null);
    return r.data;
  };
  const before = await read(),
    operation = randomUUID();
  ownership.operation = operation;
  const args = {
    p_map_id: ownership.id,
    p_operation_id: operation,
    p_editor_session_id: ownership.session,
    p_expected_revision: 1,
    p_kind: 'transfer_owner',
    p_payload: { ownerId: ids[0] },
  };
  const r = await b.rpc('apply_map_command', args);
  assert.equal(r.error, null);
  assert.equal(r.data.revision, 2);
  assert.deepEqual(r.data.changedNodes, []);
  assert.equal(r.data.mapPatch.ownerId, ids[0]);
  assert.equal(r.data.mapPatch.ownerName, run.accounts[0].name);
  assert.deepEqual((await b.rpc('apply_map_command', args)).data, r.data);
  const after = await read();
  assert.equal(after.map.ownerId, ids[0]);
  assert.deepEqual(after.nodes, before.nodes);
  const row = await admin
    .from('maps')
    .select('created_by,updated_by,revision,owner_id')
    .eq('id', ownership.id)
    .single();
  assert.equal(row.error, null);
  assert.deepEqual(row.data, { created_by: ids[1], updated_by: ids[1], revision: 2, owner_id: ids[0] });
  const logs = await admin
    .from('map_operations')
    .select('kind,actor_id,before_data,after_data')
    .eq('map_id', ownership.id)
    .eq('id', operation)
    .single();
  assert.equal(logs.error, null);
  assert.equal(logs.data.actor_id, ids[1]);
  assert.deepEqual(logs.data.before_data, { map: { ownerId: ids[1] } });
  assert.equal(logs.data.after_data.mapPatch.ownerId, ids[0]);
  assert.equal(
    (await history(b, 'undo', operation, 2, ownership.session, randomUUID(), ownership.id)).error?.message,
    'CONFLICT',
  );
  const denied = await b.rpc('apply_map_command', {
    ...args,
    p_operation_id: randomUUID(),
    p_expected_revision: 2,
    p_payload: { ownerId: ids[1] },
  });
  assert.equal(denied.error?.message, 'FORBIDDEN');
  assert.ok((await b.from('maps').update({ owner_id: ids[1] }).eq('id', ownership.id)).error);
  const edit = await command(
    b,
    'edit_text',
    { nodeId: before.nodes[0].id, text: 'B continua editando' },
    2,
    randomUUID(),
    ownership.id,
  );
  assert.equal(edit.error, null);
  assert.equal(edit.data.revision, 3);
  const edited = await read();
  assert.equal(edited.nodes[0].createdBy, ids[1]);
  assert.equal(edited.nodes[0].updatedBy, ids[1]);
  assert.equal(edited.map.ownerId, ids[0]);
});
test('owner/admin/member/foreign authorization and destination validation leave rejected transfers atomic', async () => {
  const made = await createMap(a, randomUUID(), 'Matriz de transferência');
  assert.equal(made.error, null);
  const mapId = made.data.mapId;
  const read = async () => {
    const r = await a.rpc('get_map_document', { p_map_id: mapId });
    assert.equal(r.error, null);
    return r.data;
  };
  const before = await read();
  const send = (client, payload, revision = 1, kind = 'transfer_owner') =>
    client.rpc('apply_map_command', {
      p_map_id: mapId,
      p_operation_id: randomUUID(),
      p_editor_session_id: randomUUID(),
      p_expected_revision: revision,
      p_kind: kind,
      p_payload: payload,
    });
  assert.equal((await send(b, { ownerId: ids[1] })).error?.message, 'FORBIDDEN'); // B's editable metadata already says admin; actual membership remains member.
  for (const client of [c, d]) assert.equal((await send(client, { ownerId: ids[1] })).error?.message, 'NOT_FOUND');
  assert.ok((await send(anon, { ownerId: ids[1] })).error);
  for (const payload of [
    { ownerId: ids[2] },
    { ownerId: ids[3] },
    { ownerId: randomUUID() },
    { ownerId: ids[0] },
    { ownerId: null },
    { ownerId: 'invalid' },
    {},
    { ownerId: ids[1], created_by: ids[0] },
  ])
    assert.equal((await send(a, payload)).error?.message, 'VALIDATION');
  await admin
    .from('workspace_members')
    .update({ status: 'inactive' })
    .eq('workspace_id', workspaceX)
    .eq('user_id', ids[1]);
  try {
    assert.equal((await send(a, { ownerId: ids[1] })).error?.message, 'VALIDATION');
  } finally {
    await admin
      .from('workspace_members')
      .update({ status: 'active' })
      .eq('workspace_id', workspaceX)
      .eq('user_id', ids[1]);
  }
  assert.equal((await send(a, { ownerId: ids[1] }, 0)).error?.message, 'CONFLICT');
  assert.deepEqual(await read(), before);
  const log = await admin.from('map_operations').select('id').eq('map_id', mapId);
  assert.equal(log.error, null);
  assert.equal(log.data.length, 1);
  await admin.from('maps').update({ deleted_at: new Date().toISOString() }).eq('id', mapId);
  try {
    assert.equal((await send(a, { ownerId: ids[1] })).error?.message, 'NOT_FOUND');
  } finally {
    await admin.from('maps').update({ deleted_at: null }).eq('id', mapId);
  }
});
test('admin transfers another member map; third colleague and former owner retain editing, inactive authors stay legible', async () => {
  const membership = await admin
    .from('workspace_members')
    .insert({ workspace_id: workspaceX, user_id: ids[3], role: 'member', status: 'active' });
  assert.equal(membership.error, null);
  try {
    const made = await createMap(b, randomUUID(), 'Transferência administrativa');
    assert.equal(made.error, null);
    const mapId = made.data.mapId;
    const before = (await a.rpc('get_map_document', { p_map_id: mapId })).data;
    const r = await a.rpc('apply_map_command', {
      p_map_id: mapId,
      p_operation_id: randomUUID(),
      p_editor_session_id: randomUUID(),
      p_expected_revision: 1,
      p_kind: 'transfer_owner',
      p_payload: { ownerId: ids[3] },
    });
    assert.equal(r.error, null);
    assert.equal(r.data.mapPatch.ownerId, ids[3]);
    let revision = 2;
    for (const client of [a, b, d]) {
      const edited = await command(
        client,
        'edit_text',
        { nodeId: before.nodes[0].id, text: `Edição ${revision}` },
        revision,
        randomUUID(),
        mapId,
      );
      assert.equal(edited.error, null);
      revision = edited.data.revision;
    }
    const row = await admin.from('maps').select('owner_id,created_by').eq('id', mapId).single();
    assert.deepEqual(row.data, { owner_id: ids[3], created_by: ids[1] });
    await admin
      .from('workspace_members')
      .update({ status: 'inactive' })
      .eq('workspace_id', workspaceX)
      .eq('user_id', ids[1]);
    try {
      const historical = await a.rpc('get_map_document', { p_map_id: mapId });
      assert.equal(historical.error, null);
      assert.equal(historical.data.nodes[0].createdBy, ids[1]);
      assert.equal(historical.data.people[ids[1]], run.accounts[1].name);
      const denied = await command(b, 'transfer_owner', { ownerId: ids[0] }, revision, randomUUID(), mapId);
      assert.equal(denied.error?.message, 'NOT_FOUND');
    } finally {
      await admin
        .from('workspace_members')
        .update({ status: 'active' })
        .eq('workspace_id', workspaceX)
        .eq('user_id', ids[1]);
    }
    // Competing authorized transfers share one content head; exactly one commits.
    const raceMap = await createMap(b, randomUUID());
    assert.equal(raceMap.error, null);
    const args = {
      p_map_id: raceMap.data.mapId,
      p_editor_session_id: randomUUID(),
      p_expected_revision: 1,
      p_kind: 'transfer_owner',
    };
    const race = await Promise.all([
      b.rpc('apply_map_command', { ...args, p_operation_id: randomUUID(), p_payload: { ownerId: ids[0] } }),
      a.rpc('apply_map_command', { ...args, p_operation_id: randomUUID(), p_payload: { ownerId: ids[3] } }),
    ]);
    assert.equal(race.filter((r) => r.error === null).length, 1);
    assert.equal(race.filter((r) => r.error?.message === 'CONFLICT').length, 1);
    const state = await admin.from('maps').select('revision,created_by').eq('id', raceMap.data.mapId).single();
    assert.deepEqual(state.data, { revision: 2, created_by: ids[1] });
  } finally {
    const removed = await admin.from('workspace_members').delete().eq('workspace_id', workspaceX).eq('user_id', ids[3]);
    assert.equal(removed.error, null);
  }
});

// Ticket 17: soft deletion is terminal for clients, including old operation replays.
test('owner soft-deletes once; maps, nodes, preferences and old responses become inaccessible', async () => {
  const createId = randomUUID(),
    made = await createMap(b, createId, 'Mapa para excluir');
  assert.equal(made.error, null);
  const mapId = made.data.mapId,
    session = randomUUID(),
    addId = randomUUID();
  const first = (await b.rpc('get_map_document', { p_map_id: mapId })).data,
    root = first.nodes[0].id;
  const addArgs = {
    p_map_id: mapId,
    p_operation_id: addId,
    p_editor_session_id: session,
    p_expected_revision: 1,
    p_kind: 'add_child',
    p_payload: { nodeId: randomUUID(), parentId: root, text: 'Retido apenas no servidor' },
  };
  assert.equal((await b.rpc('apply_map_command', addArgs)).error, null);
  assert.equal(
    (
      await b
        .from('map_user_preferences')
        .upsert({ map_id: mapId, user_id: ids[1], viewport: { x: 0, y: 0, zoom: 1 }, collapsed_node_ids: [] })
    ).error,
    null,
  );
  const before = await admin.from('nodes').select('*').eq('map_id', mapId).order('id');
  const operation = randomUUID();
  const args = {
    p_map_id: mapId,
    p_operation_id: operation,
    p_editor_session_id: session,
    p_expected_revision: 2,
    p_kind: 'delete_map',
    p_payload: {},
  };
  const deleted = await b.rpc('apply_map_command', args);
  assert.equal(deleted.error, null);
  assert.equal(deleted.data.revision, 3);
  assert.ok(deleted.data.mapPatch.deletedAt);
  assert.deepEqual(deleted.data.changedNodes, []);
  assert.deepEqual(
    Object.keys(deleted.data.mapPatch).sort(),
    ['revision', 'updatedBy', 'updatedAt', 'deletedAt'].sort(),
  );
  assert.deepEqual((await b.rpc('apply_map_command', args)).data, deleted.data);
  const retained = await admin.from('maps').select('deleted_at,revision,created_by').eq('id', mapId).single();
  assert.ok(retained.data.deleted_at);
  assert.equal(retained.data.revision, 3);
  assert.equal(retained.data.created_by, ids[1]);
  assert.deepEqual((await admin.from('nodes').select('*').eq('map_id', mapId).order('id')).data, before.data);
  for (const client of [a, b]) {
    for (const table of ['maps', 'nodes', 'map_user_preferences']) {
      const r = await client
        .from(table)
        .select('*')
        .eq(table === 'maps' ? 'id' : 'map_id', mapId);
      assert.equal(r.error, null);
      assert.deepEqual(r.data, []);
    }
    const doc = await client.rpc('get_map_document', { p_map_id: mapId });
    assert.equal(doc.error?.message, 'NOT_FOUND');
    assert.equal(doc.error?.details, 'MAP_DELETED');
    assert.equal(doc.data, null);
    const library = await client.rpc('list_map_library', { p_workspace_id: workspaceX, p_query: 'Mapa para excluir' });
    assert.equal(library.error, null);
    assert.equal(library.data.total, 0);
  }
  const replay = await b.rpc('apply_map_command', addArgs);
  assert.equal(replay.error?.message, 'NOT_FOUND');
  assert.equal(replay.error?.details, 'MAP_DELETED');
  assert.equal(replay.data, null);
  for (const kind of ['edit_text', 'rename_map', 'set_project', 'transfer_owner', 'delete_map']) {
    const payload =
      kind === 'edit_text'
        ? { nodeId: root, text: 'Não restaurar' }
        : kind === 'rename_map'
          ? { title: 'Não restaurar' }
          : kind === 'set_project'
            ? { projectId: null }
            : kind === 'transfer_owner'
              ? { ownerId: ids[0] }
              : {};
    const r = await command(b, kind, payload, 3, randomUUID(), mapId);
    assert.equal(r.error?.message, 'NOT_FOUND');
    assert.equal(r.error?.details, 'MAP_DELETED');
  }
  const undo = await history(b, 'undo', addId, 3, session, randomUUID(), mapId);
  assert.equal(undo.error?.message, 'NOT_FOUND');
  assert.equal(undo.error?.details, 'MAP_DELETED');
  const copy = await b.rpc('create_map_copy', {
    p_source_map_id: mapId,
    p_operation_id: randomUUID(),
    p_editor_session_id: session,
    p_title: 'Não recriar',
    p_nodes: first.nodes.map(({ id, parentId, text, sortOrder }) => ({ id, parentId, text, sortOrder })),
  });
  assert.equal(copy.error?.message, 'NOT_FOUND');
  assert.ok((await b.from('maps').update({ deleted_at: null }).eq('id', mapId)).error);
  assert.ok(
    (
      await b
        .from('nodes')
        .insert({ id: randomUUID(), map_id: mapId, text: 'Forjado', created_by: ids[1], updated_by: ids[1] })
    ).error,
  );
  for (const client of [c, d]) {
    const r = await client.rpc('get_map_document', { p_map_id: mapId });
    assert.equal(r.error, null);
    assert.equal(r.data, null);
    const denied = await client.rpc('apply_map_command', args);
    assert.equal(denied.error?.message, 'NOT_FOUND');
    assert.notEqual(denied.error?.details, 'MAP_DELETED');
  }
  await admin
    .from('workspace_members')
    .update({ status: 'inactive' })
    .eq('workspace_id', workspaceX)
    .eq('user_id', ids[1]);
  try {
    const r = await b.rpc('apply_map_command', args);
    assert.equal(r.error?.message, 'NOT_FOUND');
    assert.notEqual(r.error?.details, 'MAP_DELETED');
  } finally {
    await admin
      .from('workspace_members')
      .update({ status: 'active' })
      .eq('workspace_id', workspaceX)
      .eq('user_id', ids[1]);
  }
  assert.equal((await admin.from('map_operations').select('id').eq('map_id', mapId)).data.length, 3);
});
test('admin may delete another member map; non-owner, foreign and forged requests fail atomically', async () => {
  const ownA = await createMap(a, randomUUID(), 'Somente responsável'),
    ownB = await createMap(b, randomUUID(), 'Admin pode excluir');
  assert.equal(ownA.error, null);
  assert.equal(ownB.error, null);
  const send = (client, mapId, payload = {}, revision = 1) =>
    command(client, 'delete_map', payload, revision, randomUUID(), mapId);
  assert.equal((await send(b, ownA.data.mapId)).error?.message, 'FORBIDDEN');
  for (const client of [c, d]) assert.equal((await send(client, ownB.data.mapId)).error?.message, 'NOT_FOUND');
  assert.ok((await send(anon, ownB.data.mapId)).error);
  assert.equal((await send(b, ownB.data.mapId, { deleted_at: new Date().toISOString() })).error?.message, 'VALIDATION');
  assert.equal((await send(b, ownB.data.mapId, {}, 0)).error?.message, 'CONFLICT');
  const before = await a.rpc('get_map_document', { p_map_id: ownB.data.mapId });
  assert.equal(before.data.map.revision, 1);
  const deleted = await send(a, ownB.data.mapId);
  assert.equal(deleted.error, null);
  assert.equal(deleted.data.revision, 2);
  const row = await admin.from('maps').select('created_by,updated_by,deleted_at').eq('id', ownB.data.mapId).single();
  assert.equal(row.data.created_by, ids[1]);
  assert.equal(row.data.updated_by, ids[0]);
  assert.ok(row.data.deleted_at);
});
test('a concurrent edit/deletion has one winning revision and no stale session can restore the map', async () => {
  const made = await createMap(b, randomUUID(), 'Corrida da exclusão');
  assert.equal(made.error, null);
  const mapId = made.data.mapId,
    doc = (await b.rpc('get_map_document', { p_map_id: mapId })).data;
  const [edit, del] = await Promise.all([
    command(b, 'edit_text', { nodeId: doc.nodes[0].id, text: 'Edição concorrente' }, 1, randomUUID(), mapId),
    command(a, 'delete_map', {}, 1, randomUUID(), mapId),
  ]);
  assert.equal([edit, del].filter((r) => r.error === null).length, 1);
  if (del.error) {
    assert.equal(del.error.message, 'CONFLICT');
    assert.equal((await command(a, 'delete_map', {}, 2, randomUUID(), mapId)).error, null);
  } else {
    assert.equal(edit.error?.message, 'NOT_FOUND');
    assert.equal(edit.error?.details, 'MAP_DELETED');
  }
  const state = await admin.from('maps').select('revision,deleted_at').eq('id', mapId).single();
  assert.ok(state.data.deleted_at);
  const revision = state.data.revision;
  const stale = await command(
    b,
    'edit_text',
    { nodeId: doc.nodes[0].id, text: 'Jamais reabrir' },
    revision,
    randomUUID(),
    mapId,
  );
  assert.equal(stale.error?.message, 'NOT_FOUND');
  assert.equal((await admin.from('maps').select('revision').eq('id', mapId).single()).data.revision, revision);
});

const duplicate = (client, mapId, operationId = randomUUID(), session = randomUUID()) =>
  client.rpc('duplicate_map', { p_source_map_id: mapId, p_operation_id: operationId, p_editor_session_id: session });
test('remote duplication remaps the whole tree, project and ownership with informational provenance and no imported history/preferences', async () => {
  const made = await createMap(a, randomUUID(), 'Á'.repeat(120));
  assert.equal(made.error, null);
  const mapId = made.data.mapId;
  let doc = (await a.rpc('get_map_document', { p_map_id: mapId })).data;
  const root = doc.nodes[0].id,
    branch = randomUUID(),
    leaf = randomUUID(),
    sibling = randomUUID();
  let revision = 1;
  for (const [client, parentId, nodeId, text] of [
    [a, root, branch, 'Ramo A'],
    [b, branch, leaf, 'Folha B'],
    [a, root, sibling, 'Outro ramo'],
  ]) {
    const added = await command(client, 'add_child', { parentId, nodeId, text }, revision++, randomUUID(), mapId);
    assert.equal(added.error, null);
  }
  assert.equal((await command(a, 'set_project', { projectId: projectX }, revision++, randomUUID(), mapId)).error, null);
  // Service-only AI fixture: the product never accepts forged AI provenance.
  assert.equal(
    (await admin.from('nodes').update({ source: 'ai', ai_generation_id: randomUUID() }).eq('id', leaf)).error,
    null,
  );
  assert.equal(
    (
      await admin
        .from('map_user_preferences')
        .insert({ map_id: mapId, user_id: ids[0], viewport: { x: 10, y: 20, zoom: 1 }, collapsed_node_ids: [branch] })
    ).error,
    null,
  );
  doc = (await a.rpc('get_map_document', { p_map_id: mapId })).data;
  const operation = randomUUID(),
    session = randomUUID();
  const copied = await duplicate(b, mapId, operation, session);
  assert.equal(copied.error, null);
  const copyId = copied.data.mapId,
    copy = (await b.rpc('get_map_document', { p_map_id: copyId })).data;
  assert.notEqual(copyId, mapId);
  assert.equal(copy.map.title, 'Á'.repeat(112) + ' — cópia');
  assert.equal([...copy.map.title].length, 120);
  assert.equal(copy.map.ownerId, ids[1]);
  assert.equal(copy.map.projectId, projectX);
  assert.equal(copy.map.revision, 1);
  assert.equal(copy.nodes.length, doc.nodes.length);
  const byText = new Map(copy.nodes.map((n) => [n.text, n]));
  for (const original of doc.nodes) {
    const n = byText.get(original.text);
    assert.ok(n);
    assert.ok(!doc.nodes.some((old) => old.id === n.id));
    assert.equal(n.sortOrder, original.sortOrder);
    assert.equal(n.createdBy, ids[1]);
    assert.equal(n.updatedBy, ids[1]);
    assert.equal(n.source, 'manual');
    assert.equal(
      n.parentId,
      original.parentId ? byText.get(doc.nodes.find((old) => old.id === original.parentId).text).id : null,
    );
  }
  const mapRow = (await admin.from('maps').select('created_by,updated_by').eq('id', copyId).single()).data;
  assert.deepEqual(mapRow, { created_by: ids[1], updated_by: ids[1] });
  const logs = (await admin.from('map_operations').select('kind,before_data').eq('map_id', copyId)).data;
  assert.deepEqual(logs, [
    { kind: 'duplicate_map', before_data: { sourceMapId: mapId, sourceRevision: doc.map.revision } },
  ]);
  assert.deepEqual((await admin.from('map_user_preferences').select('*').eq('map_id', copyId)).data, []);
  assert.ok(
    (await admin.from('nodes').select('ai_generation_id').eq('map_id', copyId)).data.every(
      (n) => n.ai_generation_id === null,
    ),
  );
  assert.equal(
    (
      await command(
        b,
        'edit_text',
        { nodeId: byText.get('Folha B').id, text: 'Somente cópia' },
        1,
        randomUUID(),
        copyId,
      )
    ).error,
    null,
  );
  assert.equal(
    (await command(b, 'delete_subtree', { nodeId: byText.get('Ramo A').id }, 2, randomUUID(), copyId)).error,
    null,
  );
  assert.deepEqual((await a.rpc('get_map_document', { p_map_id: mapId })).data, doc);
  assert.deepEqual((await duplicate(b, mapId, operation, session)).data, copied.data);
  // Changing or deleting the origin never becomes an authorization rule for its copy.
  assert.equal((await command(a, 'delete_map', {}, revision, randomUUID(), mapId)).error, null);
  assert.ok((await b.rpc('get_map_document', { p_map_id: copyId })).data);
  assert.equal(
    (
      await command(
        b,
        'edit_text',
        { nodeId: copy.nodes.find((n) => n.parentId === null).id, text: 'Independente da origem excluída' },
        3,
        randomUUID(),
        copyId,
      )
    ).error,
    null,
  );
});
test('remote duplicate replay is stable across source edits, simultaneous clicks and rejects reused identifiers or foreign/deleted/revoked sources', async () => {
  const made = await createMap(a, randomUUID(), 'Idempotência remota');
  assert.equal(made.error, null);
  const mapId = made.data.mapId,
    operation = randomUUID(),
    session = randomUUID();
  const [first, second] = await Promise.all([
    duplicate(b, mapId, operation, session),
    duplicate(b, mapId, operation, session),
  ]);
  assert.equal(first.error, null);
  assert.deepEqual(second.data, first.data);
  assert.equal((await command(a, 'rename_map', { title: 'Origem alterada' }, 1, randomUUID(), mapId)).error, null);
  assert.deepEqual((await duplicate(b, mapId, operation, session)).data, first.data);
  assert.equal(
    (await b.rpc('get_map_document', { p_map_id: first.data.mapId })).data.map.title,
    'Idempotência remota — cópia',
  );
  for (const client of [c, d, anon]) assert.ok((await duplicate(client, mapId)).error);
  assert.equal((await duplicate(a, mapId, operation, session)).error?.message, 'CONFLICT');
  assert.equal((await duplicate(b, mapId, operation, randomUUID())).error?.message, 'CONFLICT');
  assert.equal((await duplicate(b, created.mapId, operation, session)).error?.message, 'CONFLICT');
  assert.equal(
    (await b.rpc('duplicate_map', { p_source_map_id: mapId, p_operation_id: null, p_editor_session_id: session })).error
      ?.message,
    'VALIDATION',
  );
  assert.equal(
    (
      await admin
        .from('workspace_members')
        .update({ status: 'inactive' })
        .eq('workspace_id', workspaceX)
        .eq('user_id', ids[1])
    ).error,
    null,
  );
  try {
    assert.equal((await duplicate(b, mapId, operation, session)).error?.message, 'NOT_FOUND');
  } finally {
    assert.equal(
      (
        await admin
          .from('workspace_members')
          .update({ status: 'active' })
          .eq('workspace_id', workspaceX)
          .eq('user_id', ids[1])
      ).error,
      null,
    );
  }
  assert.equal((await command(a, 'delete_map', {}, 2, randomUUID(), mapId)).error, null);
  const deleted = await duplicate(b, mapId, operation, session);
  assert.equal(deleted.error?.message, 'NOT_FOUND');
  assert.equal(deleted.error?.details, 'MAP_DELETED');
});
test('a concurrent remote duplication and structural command use a coherent locked source snapshot', async () => {
  const made = await createMap(a, randomUUID(), 'Snapshot coerente');
  assert.equal(made.error, null);
  const mapId = made.data.mapId,
    before = (await a.rpc('get_map_document', { p_map_id: mapId })).data;
  const [copied, edit] = await Promise.all([
    duplicate(b, mapId),
    command(
      a,
      'add_child',
      { nodeId: randomUUID(), parentId: before.nodes[0].id, text: 'Concorrente' },
      1,
      randomUUID(),
      mapId,
    ),
  ]);
  assert.equal(copied.error, null);
  assert.equal(edit.error, null);
  const copy = (await b.rpc('get_map_document', { p_map_id: copied.data.mapId })).data,
    after = (await a.rpc('get_map_document', { p_map_id: mapId })).data;
  const origin = (await admin.from('map_operations').select('before_data').eq('id', copied.data.operationId).single())
    .data.before_data;
  const expected = origin.sourceRevision === 1 ? before : after;
  assert.equal(copy.nodes.length, expected.nodes.length);
  assert.deepEqual(copy.nodes.map((n) => n.text).sort(), expected.nodes.map((n) => n.text).sort());
});
test('remote copy validates the entire snapshot and refuses disconnected cycles without leaving a partial map or log', async () => {
  const made = await createMap(a, randomUUID(), 'Origem inválida de teste');
  assert.equal(made.error, null);
  const mapId = made.data.mapId,
    root = (await a.rpc('get_map_document', { p_map_id: mapId })).data.nodes[0].id;
  const x = randomUUID(),
    y = randomUUID();
  for (const [i, nodeId] of [x, y].entries())
    assert.equal(
      (await command(a, 'add_child', { nodeId, parentId: root, text: 'Ciclo controlado' }, i + 1, randomUUID(), mapId))
        .error,
      null,
    );
  // Privileged fixture only: normal finite commands already reject this state.
  assert.equal((await admin.from('nodes').update({ parent_id: y }).eq('id', x)).error, null);
  assert.equal((await admin.from('nodes').update({ parent_id: x }).eq('id', y)).error, null);
  const operation = randomUUID(),
    before = await admin.from('maps').select('id').eq('workspace_id', workspaceX).order('id');
  assert.equal(before.error, null);
  assert.equal((await duplicate(b, mapId, operation)).error?.message, 'VALIDATION');
  assert.deepEqual(
    (await admin.from('maps').select('id').eq('workspace_id', workspaceX).order('id')).data,
    before.data,
  );
  assert.deepEqual((await admin.from('map_operations').select('id').eq('id', operation)).data, []);
});

const portable = (
  nodes = [{ id: randomUUID(), parentId: null, text: 'Raiz 🌍', sortOrder: 0 }],
  title = 'Backup — Café 日本語',
) => ({
  format: 'mapa-mental',
  version: 1,
  exportedAt: '2026-10-20T12:00:00.000Z',
  hasPendingChanges: false,
  map: { title },
  nodes,
});
const importBackup = (client, backup, operationId = randomUUID(), session = randomUUID()) =>
  client.rpc('import_map_backup', { p_operation_id: operationId, p_editor_session_id: session, p_backup: backup });
test('portable import roundtrip uses fresh node IDs, exact parent/text/order and actor ownership with no origin dependency or history', async () => {
  const source = await createMap(a, randomUUID(), 'Roundtrip exportado');
  assert.equal(source.error, null);
  const sourceId = source.data.mapId,
    initial = (await a.rpc('get_map_document', { p_map_id: sourceId })).data;
  const root = initial.nodes[0].id,
    branch = randomUUID(),
    leaf = randomUUID();
  let revision = 1;
  for (const [client, parentId, nodeId, text] of [
    [a, root, branch, 'Ação e conexão 🌎'],
    [b, branch, leaf, '日本語\n<script>texto literal</script>'],
  ])
    assert.equal(
      (await command(client, 'add_child', { parentId, nodeId, text }, revision++, randomUUID(), sourceId)).error,
      null,
    );
  const before = (await a.rpc('get_map_document', { p_map_id: sourceId })).data;
  const file = portable(
      before.nodes.map(({ id, parentId, text, sortOrder }) => ({ id, parentId, text, sortOrder })),
      before.map.title,
    ),
    operation = randomUUID(),
    session = randomUUID();
  // Portable ordering is independent of input array order and preserves large valid integer indices.
  file.nodes.reverse();
  file.nodes.find((n) => n.parentId !== null).sortOrder = 2147483647;
  const [first, second] = await Promise.all([
    importBackup(b, file, operation, session),
    importBackup(b, file, operation, session),
  ]);
  assert.equal(first.error, null);
  assert.deepEqual(second.data, first.data);
  const copyId = first.data.mapId,
    copy = (await b.rpc('get_map_document', { p_map_id: copyId })).data;
  assert.notEqual(copyId, sourceId);
  assert.equal(copy.map.ownerId, ids[1]);
  assert.equal(copy.map.workspaceId, workspaceX);
  assert.equal(copy.map.projectId, null);
  assert.equal(copy.map.revision, 1);
  assert.equal(copy.map.title, file.map.title);
  const byText = new Map(copy.nodes.map((n) => [n.text, n]));
  for (const n of file.nodes) {
    const copied = byText.get(n.text);
    assert.ok(copied);
    assert.ok(!file.nodes.some((old) => old.id === copied.id));
    assert.equal(
      copied.sortOrder,
      file.nodes
        .filter((sibling) => sibling.parentId === n.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        .findIndex((sibling) => sibling.id === n.id),
    );
    assert.equal(
      copied.parentId,
      n.parentId ? byText.get(file.nodes.find((old) => old.id === n.parentId).text).id : null,
    );
    assert.equal(copied.createdBy, ids[1]);
    assert.equal(copied.updatedBy, ids[1]);
    assert.equal(copied.source, 'manual');
  }
  assert.deepEqual((await admin.from('maps').select('created_by,updated_by').eq('id', copyId).single()).data, {
    created_by: ids[1],
    updated_by: ids[1],
  });
  assert.deepEqual((await admin.from('map_operations').select('kind,before_data').eq('map_id', copyId)).data, [
    { kind: 'import_map', before_data: null },
  ]);
  assert.deepEqual((await admin.from('map_user_preferences').select('*').eq('map_id', copyId)).data, []);
  assert.deepEqual((await a.rpc('get_map_document', { p_map_id: sourceId })).data, before);
  assert.equal(
    (await command(b, 'edit_text', { nodeId: copy.nodes[0].id, text: 'Somente a cópia' }, 1, randomUUID(), copyId))
      .error,
    null,
  );
  assert.deepEqual((await a.rpc('get_map_document', { p_map_id: sourceId })).data, before);
  const sparse = file.nodes.find((n) => n.sortOrder === 2147483647),
    parentText = file.nodes.find((n) => n.id === sparse.parentId).text;
  assert.equal(
    (
      await command(
        b,
        'add_child',
        { nodeId: randomUUID(), parentId: byText.get(parentText).id, text: 'Novo irmão após importação' },
        2,
        randomUUID(),
        copyId,
      )
    ).error,
    null,
  );
  assert.equal((await importBackup(a, file, operation, session)).error?.message, 'CONFLICT');
  assert.equal(
    (await importBackup(b, { ...file, map: { title: 'Mudado' } }, operation, session)).error?.message,
    'CONFLICT',
  );
  assert.equal((await importBackup(b, file, operation, randomUUID())).error?.message, 'CONFLICT');
});
test('direct import API rejects invalid structure, version, forged scope/authors, text, integers and size with no partial map or log', async () => {
  const root = randomUUID(),
    x = randomUUID(),
    y = randomUUID(),
    n = (id, parentId, text = 'Texto', sortOrder = 0) => ({ id, parentId, text, sortOrder });
  const invalid = [
    portable([]),
    portable([n(root, null), n(x, null)]),
    portable([n(root, null), n(x, y)]),
    portable([n(root, null), n(x, y), n(y, x)]),
    portable([n(root, null), n(root, root)]),
    portable([n(root, null), n(root.toUpperCase(), root)]),
    { ...portable(), version: 2 },
    { ...portable(), format: 'mapa-emergency-draft' },
    { ...portable(), exportedAt: 'not a date' },
    { ...portable(), exportedAt: '2026-02-31T12:00:00Z' },
    { ...portable(), hasPendingChanges: 'yes' },
    { ...portable(), workspaceId: workspaceY },
    portable(undefined, ''),
    portable(undefined, '\n\t'),
    { ...portable(), map: { title: 'Forjado', ownerId: ids[0] } },
    portable([n(root, null, '')]),
    portable([n(root, null, '\n\t')]),
    portable([n(root, null, 'x'.repeat(501))]),
    portable([n(root, null, 'Texto', -1)]),
    portable([n(root, null, 'Texto', 0.5)]),
    portable([n(root, null, 'Texto', 2147483648)]),
    portable([{ ...n(root, null), createdBy: ids[0], source: 'ai' }]),
    portable(
      Array.from({ length: 32 }, (_, i) =>
        n(
          `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
          i === 0 ? null : `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        ),
      ),
    ),
  ];
  const rows = async () => {
    const r = await admin.from('maps').select('id').eq('workspace_id', workspaceX).order('id');
    assert.equal(r.error, null);
    return r.data;
  };
  const before = await rows();
  for (const file of invalid) {
    const operation = randomUUID();
    const r = await importBackup(b, file, operation);
    assert.ok(['VALIDATION', 'LIMIT_EXCEEDED'].includes(r.error?.message), JSON.stringify(r.error));
    assert.deepEqual((await admin.from('map_operations').select('id').eq('id', operation)).data, []);
  }
  const huge = { ...portable(), extra: 'x'.repeat(2097153) };
  assert.equal((await importBackup(b, huge)).error?.message, 'LIMIT_EXCEEDED');
  assert.deepEqual(await rows(), before);
});
test('import destinations come from active membership, never file IDs; anon, no-membership and revoked replay cannot create/read results', async () => {
  const file = portable(),
    operation = randomUUID(),
    session = randomUUID();
  for (const client of [anon, d]) assert.ok((await importBackup(client, file)).error);
  const x = await importBackup(b, file, operation, session);
  assert.equal(x.error, null);
  const y = await importBackup(c, file);
  assert.equal(y.error, null);
  const yDoc = (await c.rpc('get_map_document', { p_map_id: y.data.mapId })).data;
  assert.equal(yDoc.map.workspaceId, workspaceY);
  assert.equal(yDoc.map.ownerId, ids[2]);
  assert.equal((await a.rpc('get_map_document', { p_map_id: y.data.mapId })).data, null);
  assert.equal(
    (
      await admin
        .from('workspace_members')
        .update({ status: 'inactive' })
        .eq('workspace_id', workspaceX)
        .eq('user_id', ids[1])
    ).error,
    null,
  );
  try {
    assert.equal((await importBackup(b, file, operation, session)).error?.message, 'FORBIDDEN');
  } finally {
    assert.equal(
      (
        await admin
          .from('workspace_members')
          .update({ status: 'active' })
          .eq('workspace_id', workspaceX)
          .eq('user_id', ids[1])
      ).error,
      null,
    );
  }
});
