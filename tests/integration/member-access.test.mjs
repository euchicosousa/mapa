import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readTarget, createRun, cleanupRun } from '../../scripts/validation-run.mjs';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
let target, run, admin, clients, map, original;
before(async () => {
  target = readTarget();
  run = await createRun(target);
  admin = createClient(target.url, target.secretKey, options);
  clients = {};
  for (const a of run.accounts) {
    const client = createClient(target.url, target.publicKey, options);
    assert.ifError((await client.auth.signInWithPassword({ email: a.email, password: a.password })).error);
    clients[a.key] = client;
  }
  const made = await clients.B.rpc('create_map', {
    p_workspace_id: run.workspaces.X.id,
    p_operation_id: randomUUID(),
    p_editor_session_id: randomUUID(),
    p_title: 'Member access ' + run.runId,
  });
  assert.ifError(made.error);
  map = made.data.mapId;
  original = (await clients.B.rpc('get_map_document', { p_map_id: map })).data;
});
after(async () => {
  if (run) await cleanupRun(target, run.runId);
});
const account = (key) => run.accounts.find((a) => a.key === key);
const change = (actor, user, status) =>
  clients[actor].rpc('set_member_access', {
    p_workspace: run.workspaces.X.id,
    p_user: account(user).id,
    p_status: status,
  });
async function transfer(owner) {
  const doc = await clients.A.rpc('get_map_document', { p_map_id: map });
  assert.ifError(doc.error);
  return clients.A.rpc('apply_map_command', {
    p_map_id: map,
    p_operation_id: randomUUID(),
    p_editor_session_id: randomUUID(),
    p_expected_revision: doc.data.map.revision,
    p_kind: 'transfer_owner',
    p_payload: { ownerId: account(owner).id },
  });
}
test('only an active administrator can change status; browser cannot change role', async () => {
  for (const actor of ['B', 'C', 'D']) assert.equal((await change(actor, 'B', 'active')).error.message, 'FORBIDDEN');
  const direct = await clients.B.from('workspace_members')
    .update({ role: 'admin', status: 'active' })
    .eq('workspace_id', run.workspaces.X.id)
    .eq('user_id', account('B').id);
  assert.ok(direct.error);
  const anon = createClient(target.url, target.publicKey, options);
  assert.ok(
    (
      await anon.rpc('set_member_access', {
        p_workspace: run.workspaces.X.id,
        p_user: account('B').id,
        p_status: 'inactive',
      })
    ).error,
  );
});
test('last admin and owners are blocked with only authorized map links', async () => {
  assert.equal((await change('A', 'A', 'inactive')).data.error, 'LAST_ADMIN');
  const result = await change('A', 'B', 'inactive');
  assert.ifError(result.error);
  assert.equal(result.data.error, 'OWNED_MAPS');
  assert.deepEqual(result.data.maps, [{ id: map, title: original.map.title }]);
  const foreign = await change('A', 'C', 'inactive');
  assert.equal(foreign.error.message, 'NOT_FOUND');
});
test('deactivation denies old-token reads/writes and preserves historical creators', async () => {
  assert.ifError((await transfer('A')).error);
  const token = (await clients.B.auth.getSession()).data.session.access_token;
  const result = await change('A', 'B', 'inactive');
  assert.ifError(result.error);
  assert.equal(result.data.status, 'inactive');
  assert.ifError((await clients.B.auth.getUser()).error);
  assert.equal((await clients.B.auth.getSession()).data.session.access_token, token);
  const doc = await clients.B.rpc('get_map_document', { p_map_id: map });
  assert.ifError(doc.error);
  assert.equal(doc.data, null);
  const denied = await clients.B.rpc('apply_map_command', {
    p_map_id: map,
    p_operation_id: randomUUID(),
    p_editor_session_id: randomUUID(),
    p_expected_revision: 2,
    p_kind: 'edit_text',
    p_payload: { nodeId: original.nodes[0].id, text: 'Denied' },
  });
  assert.equal(denied.error.message, 'NOT_FOUND');
  assert.equal((await change('B', 'B', 'active')).error.message, 'FORBIDDEN');
  const retained = (await clients.A.rpc('get_map_document', { p_map_id: map })).data;
  const creator = await admin.from('maps').select('created_by').eq('id', map).single();
  assert.ifError(creator.error);
  assert.equal(creator.data.created_by, account('B').id);
  assert.equal(retained.nodes[0].createdBy, account('B').id);
  const profile = await clients.A.from('profiles').select('display_name').eq('id', account('B').id).single();
  assert.ifError(profile.error);
  assert.equal(profile.data.display_name, account('B').name);
  assert.ifError((await change('A', 'B', 'active')).error);
  assert.equal((await clients.B.rpc('get_map_document', { p_map_id: map })).data.map.id, map);
  const membership = await admin
    .from('workspace_members')
    .select('role,status')
    .eq('workspace_id', run.workspaces.X.id)
    .eq('user_id', account('B').id)
    .single();
  assert.deepEqual(membership.data, { role: 'member', status: 'active' });
});
test('concurrent self-deactivation preserves at least one administrator', async () => {
  assert.ifError(
    (
      await admin
        .from('workspace_members')
        .insert({ workspace_id: run.workspaces.X.id, user_id: account('D').id, role: 'admin', status: 'active' })
    ).error,
  );
  assert.ifError((await transfer('B')).error);
  const results = await Promise.all([change('A', 'A', 'inactive'), change('D', 'D', 'inactive')]);
  results.forEach((r) => assert.ifError(r.error));
  assert.equal(results.filter((r) => r.data.status === 'inactive').length, 1);
  assert.equal(results.filter((r) => r.data.error === 'LAST_ADMIN').length, 1);
  const survivor = results[0].data.status === 'inactive' ? 'D' : 'A',
    inactive = survivor === 'A' ? 'D' : 'A';
  assert.ifError((await change(survivor, inactive, 'active')).error);
});
test('transfer and deactivation compete without assigning maps to an inactive owner', async () => {
  for (let i = 0; i < 3; i++) {
    assert.ifError((await change('A', 'B', 'active')).error);
    const head = (await clients.A.rpc('get_map_document', { p_map_id: map })).data;
    if (head.map.ownerId !== account('A').id) assert.ifError((await transfer('A')).error);
    const [revoked, moved] = await Promise.all([change('A', 'B', 'inactive'), transfer('B')]);
    assert.ifError(revoked.error);
    const doc = (await clients.A.rpc('get_map_document', { p_map_id: map })).data;
    if (revoked.data.status === 'inactive') {
      assert.equal(moved.error.message, 'VALIDATION');
      assert.equal(doc.map.ownerId, account('A').id);
    } else {
      assert.equal(revoked.data.error, 'OWNED_MAPS');
      assert.ifError(moved.error);
      assert.equal(doc.map.ownerId, account('B').id);
    }
  }
});
test('new map creation cannot race past a completed deactivation', async () => {
  assert.ifError((await change('A', 'B', 'active')).error);
  const head = (await clients.A.rpc('get_map_document', { p_map_id: map })).data;
  if (head.map.ownerId !== account('A').id) assert.ifError((await transfer('A')).error);
  const [revoked, made] = await Promise.all([
    change('A', 'B', 'inactive'),
    clients.B.rpc('create_map', {
      p_workspace_id: run.workspaces.X.id,
      p_operation_id: randomUUID(),
      p_editor_session_id: randomUUID(),
      p_title: 'Concurrent ownership ' + run.runId,
    }),
  ]);
  assert.ifError(revoked.error);
  if (made.error) {
    assert.ok(['NOT_FOUND', 'FORBIDDEN', 'VALIDATION'].includes(made.error.message));
    assert.equal(revoked.data.status, 'inactive');
  } else {
    assert.equal(revoked.data.error, 'OWNED_MAPS');
    const member = await admin
      .from('workspace_members')
      .select('status')
      .eq('workspace_id', run.workspaces.X.id)
      .eq('user_id', account('B').id)
      .single();
    assert.equal(member.data.status, 'active');
  }
});
test('accepting an older pending invitation cannot deadlock self-deactivation', async () => {
  // Models a valid older invitation retained after administrative reactivation.
  // Only this run's identity/workspace are changed; no email is sent.
  for (let i = 0; i < 3; i++) {
    const invitation = await admin
      .from('workspace_invitations')
      .insert({
        workspace_id: run.workspaces.X.id,
        email: account('A').email,
        invited_by: account('D').id,
        auth_user_id: account('A').id,
        delivery_state: 'existing',
      })
      .select('id')
      .single();
    assert.ifError(invitation.error);
    const [accepted, blocked] = await Promise.all([
      clients.A.rpc('accept_workspace_invitation', { p_id: invitation.data.id }),
      change('A', 'A', 'inactive'),
    ]);
    assert.ifError(accepted.error);
    assert.ifError(blocked.error);
    assert.equal(blocked.data.error, 'OWNED_MAPS');
  }
});
