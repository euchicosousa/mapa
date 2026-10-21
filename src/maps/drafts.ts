import { z } from 'zod';
import { mapDocument } from './api';
import { editorSessionId } from './editor-session';
import { MAP_NODES_MAX, MAP_TITLE_MAX } from './limits';

const index = z
  .number()
  .int()
  .min(0)
  .max(MAP_NODES_MAX - 1);
const payload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('delete_map'), payload: z.object({}).strict() }),
  z.object({ kind: z.literal('transfer_owner'), payload: z.object({ ownerId: z.uuid() }) }),
  z.object({ kind: z.literal('rename_map'), payload: z.object({ title: z.string() }) }),
  z.object({ kind: z.literal('set_project'), payload: z.object({ projectId: z.uuid().nullable() }) }),
  z.object({
    kind: z.literal('move_subtree'),
    payload: z.object({ nodeId: z.uuid(), newParentId: z.uuid(), targetIndex: index }),
  }),
  z.object({ kind: z.literal('reorder_siblings'), payload: z.object({ nodeId: z.uuid(), targetIndex: index }) }),
  z.object({
    kind: z.literal('add_child'),
    payload: z.object({ nodeId: z.uuid(), parentId: z.uuid(), text: z.string() }),
  }),
  z.object({ kind: z.literal('edit_text'), payload: z.object({ nodeId: z.uuid(), text: z.string() }) }),
  z.object({ kind: z.literal('delete_subtree'), payload: z.object({ nodeId: z.uuid() }) }),
]);
const operation = payload
  .and(
    z.object({
      operationId: z.uuid(),
      sent: z.boolean(),
      expectedRevision: z.number().int().positive().optional(),
      editorSessionId: z.uuid().optional(),
    }),
  )
  .refine((entry) => !entry.sent || (entry.expectedRevision !== undefined && entry.editorSessionId !== undefined));
const copy = z.object({
  sourceMapId: z.uuid(),
  operationId: z.uuid(),
  editorSessionId: z.uuid(),
  title: z.string().min(1).max(MAP_TITLE_MAX),
  nodes: z
    .array(
      z.object({
        id: z.uuid(),
        parentId: z.uuid().nullable(),
        text: z.string(),
        sortOrder: z.number().int().nonnegative(),
      }),
    )
    .max(MAP_NODES_MAX),
});
const history = z.object({
  mapId: z.uuid(),
  operationId: z.uuid(),
  editorSessionId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  targetOperationId: z.uuid(),
  mode: z.enum(['undo', 'redo']),
});
export const draftSchema = z
  .object({
    version: z.literal(1),
    userId: z.uuid(),
    workspaceId: z.uuid(),
    mapId: z.uuid(),
    sessionId: z.uuid(),
    epoch: z.number().int().nonnegative(),
    mapEpoch: z.number().int().nonnegative().default(0),
    base: mapDocument,
    queue: z.array(operation),
    draft: z.object({ nodeId: z.uuid(), text: z.string() }).nullable(),
    selectedNodeId: z.uuid().nullable(),
    conflict: z.boolean(),
    needsHeadCheck: z.boolean(),
    copyRequest: copy.nullable(),
    updatedAt: z.string(),
    pendingHistory: history.nullable().optional(),
    undoRequested: z.uuid().nullable().optional(),
  })
  .refine(
    (record) =>
      !record.pendingHistory ||
      (record.pendingHistory.mapId === record.mapId && record.pendingHistory.editorSessionId === record.sessionId),
  );
export type DraftRecord = z.infer<typeof draftSchema>;
export type DraftScope = Pick<DraftRecord, 'userId' | 'workspaceId' | 'mapId'>;
const scopeKey = (scope: DraftScope) => [scope.userId, scope.workspaceId, scope.mapId];
const key = (scope: DraftScope) => [scope.userId, scope.workspaceId, scope.mapId, editorSessionId];

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mapa.drafts.v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts');
      request.result.createObjectStore('epochs');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('STORAGE_BLOCKED'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('STORAGE_FAILED'));
  });
}
export async function readDraft(scope: DraftScope) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(['drafts', 'epochs'], 'readonly');
    const done = completed(tx);
    const epochRequest = tx.objectStore('epochs').get(scope.userId);
    const mapEpochRequest = tx.objectStore('epochs').get(scopeKey(scope));
    const recordRequest = tx.objectStore('drafts').get(key(scope));
    await done;
    const epoch = Number(epochRequest.result ?? 0);
    const mapEpoch = Number(mapEpochRequest.result ?? 0);
    const raw: unknown = recordRequest.result;
    if (raw === undefined) return { epoch, mapEpoch, record: null };
    const record = draftSchema.parse(raw);
    if (
      record.userId !== scope.userId ||
      record.workspaceId !== scope.workspaceId ||
      record.mapId !== scope.mapId ||
      record.sessionId !== editorSessionId ||
      record.epoch !== epoch ||
      record.mapEpoch !== mapEpoch
    )
      return { epoch, mapEpoch, record: null };
    return { epoch, mapEpoch, record };
  } finally {
    db.close();
  }
}
// Epoch and record share the transaction: a late tab cannot recreate erased data
// after explicit logout/revocation, even when its write was already queued.
export async function writeDraft(record: DraftRecord, pending: boolean) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(['drafts', 'epochs'], 'readwrite');
    const done = completed(tx);
    let stale = false;
    const epoch = tx.objectStore('epochs').get(record.userId);
    const mapEpoch = tx.objectStore('epochs').get(scopeKey(record));
    mapEpoch.onsuccess = () => {
      if (Number(epoch.result ?? 0) !== record.epoch || Number(mapEpoch.result ?? 0) !== record.mapEpoch) {
        stale = true;
        return;
      }
      const store = tx.objectStore('drafts');
      if (pending) store.put(record, key(record));
      else store.delete(key(record));
    };
    await done;
    if (stale) throw new Error('STORAGE_REVOKED');
  } finally {
    db.close();
  }
}
export async function clearMapDrafts(scope: DraftScope) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(['drafts', 'epochs'], 'readwrite');
    const done = completed(tx);
    const epoch = tx.objectStore('epochs').get(scopeKey(scope));
    epoch.onsuccess = () => tx.objectStore('epochs').put(Number(epoch.result ?? 0) + 1, scopeKey(scope));
    const cursor = tx.objectStore('drafts').openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      const entryKey = entry.key;
      if (Array.isArray(entryKey) && scopeKey(scope).every((value, index) => entryKey[index] === value)) entry.delete();
      entry.continue();
    };
    await done;
  } finally {
    db.close();
  }
}
export async function clearAccountDrafts(userId: string) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(['drafts', 'epochs'], 'readwrite');
    const done = completed(tx);
    const epoch = tx.objectStore('epochs').get(userId);
    epoch.onsuccess = () => tx.objectStore('epochs').put(Number(epoch.result ?? 0) + 1, userId);
    const cursor = tx.objectStore('drafts').openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      if (Array.isArray(entry.key) && entry.key[0] === userId) entry.delete();
      entry.continue();
    };
    await done;
  } finally {
    db.close();
  }
}

export function downloadEmergencyDraft(record: DraftRecord) {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: 'mapa-emergency-draft',
          version: 1,
          warning: 'Rascunho técnico de emergência; não é o backup portátil do Mapa.',
          record,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mapa-rascunho-${record.mapId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
