import { z } from 'zod';
import { editorSessionId } from './editor-session';
export { editorSessionId } from './editor-session';
import { supabase } from '../lib/supabase';
import type { PortableBackup } from './backup';

export const mapErrorCodes = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'LIMIT_EXCEEDED',
] as const;
export type MapErrorCode = (typeof mapErrorCodes)[number] | 'UNAVAILABLE';
export class MapError extends Error {
  constructor(
    readonly code: MapErrorCode,
    readonly deleted = false,
  ) {
    super(code);
    this.name = 'MapError';
  }
}
// Server functions raise typed codes as the message; anything else is a service failure.
export function toMapError(error: { message?: string; code?: string; details?: string } | null | undefined): MapError {
  if (['PGRST301', 'PGRST302', 'PGRST303'].includes(error?.code ?? '')) return new MapError('UNAUTHENTICATED');
  const code = mapErrorCodes.find((candidate) => candidate === error?.message);
  return new MapError(code ?? 'UNAVAILABLE', code === 'NOT_FOUND' && error?.details === 'MAP_DELETED');
}

// One id per tab: identifies this editor session in the operation log.
export const mapId = z.uuid();

const created = z.object({ operationId: z.uuid(), mapId: z.uuid(), revision: z.number().int().min(1) });
const node = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  text: z.string(),
  sortOrder: z.number().int(),
  createdBy: z.uuid(),
  updatedBy: z.uuid(),
  source: z.enum(['manual', 'ai']),
  aiGenerationId: z.uuid().nullable().optional(),
});
export const mapDocument = z.object({
  map: z.object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    title: z.string(),
    projectId: z.uuid().nullable().optional(),
    ownerId: z.uuid(),
    ownerName: z.string().nullable(),
    revision: z.number().int().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  nodes: z.array(node),
  // Display names of the owner and of every node's creator and last editor.
  people: z.record(z.string(), z.string()).default({}),
});
export type MapDocument = z.infer<typeof mapDocument>;
export type MapNode = z.infer<typeof node>;
export const NODE_TEXT_MAX = 500;
// Same rule as the server: plain text, 1–500 characters, not blank. Never truncated.
export const validNodeText = (text: string) => text.length >= 1 && text.length <= NODE_TEXT_MAX && text.trim() !== '';

export type MapCommand =
  | { kind: 'add_child'; payload: { nodeId: string; parentId: string; text: string } }
  | { kind: 'edit_text'; payload: { nodeId: string; text: string } }
  | { kind: 'delete_subtree'; payload: { nodeId: string } }
  | { kind: 'move_subtree'; payload: { nodeId: string; newParentId: string; targetIndex: number } }
  | { kind: 'reorder_siblings'; payload: { nodeId: string; targetIndex: number } }
  | { kind: 'rename_map'; payload: { title: string } }
  | { kind: 'set_project'; payload: { projectId: string | null } }
  | { kind: 'transfer_owner'; payload: { ownerId: string } }
  | { kind: 'delete_map'; payload: Record<string, never> };
export const commandResult = z.object({
  operationId: z.uuid(),
  revision: z.number().int().min(1),
  changedNodes: z.array(node),
  deletedNodeIds: z.array(z.uuid()),
  mapPatch: z.object({
    revision: z.number().int().min(1),
    updatedBy: z.uuid(),
    updatedAt: z.string(),
    title: z.string().optional(),
    projectId: z.uuid().nullable().optional(),
    ownerId: z.uuid().optional(),
    ownerName: z.string().nullable().optional(),
    deletedAt: z.string().optional(),
  }),
});
export type CommandResult = z.infer<typeof commandResult>;
export type CommandRequest = MapCommand & {
  mapId: string;
  operationId: string;
  expectedRevision: number;
  editorSessionId?: string;
};
export type SendCommand = (request: CommandRequest, signal: AbortSignal) => Promise<CommandResult>;
export type HistoryRequest = {
  mapId: string;
  operationId: string;
  targetOperationId: string;
  expectedRevision: number;
  editorSessionId: string;
  mode: 'undo' | 'redo';
};
export type HistoryAction = (request: HistoryRequest, signal: AbortSignal) => Promise<CommandResult>;
export const validMapTitle = (text: string) => text.length >= 1 && text.length <= 120 && text.trim() !== '';

function client() {
  if (!supabase) throw new MapError('UNAVAILABLE');
  return supabase;
}

// Idempotent: retrying with the same operationId returns the first map.
export async function createMap(workspaceId: string, operationId: string) {
  const { data, error } = await client().rpc('create_map', {
    p_workspace_id: workspaceId,
    p_operation_id: operationId,
    p_editor_session_id: editorSessionId,
  });
  if (error) throw toMapError(error);
  return created.parse(data);
}

// Inaccessible and nonexistent maps are indistinguishable by design.
export async function getMapDocument(id: string, signal: AbortSignal): Promise<MapDocument> {
  const { data, error } = await client().rpc('get_map_document', { p_map_id: id }).abortSignal(signal);
  if (error) throw toMapError(error);
  if (data === null) throw new MapError('NOT_FOUND');
  return mapDocument.parse(data);
}

// One document mutation. A retry sends the same operationId and payload: the server
// returns the first result instead of applying it twice.
export const applyMapCommand: SendCommand = async (request, signal) => {
  const { data, error } = await client()
    .rpc('apply_map_command', {
      p_map_id: request.mapId,
      p_operation_id: request.operationId,
      p_editor_session_id: request.editorSessionId ?? editorSessionId,
      p_expected_revision: request.expectedRevision,
      p_kind: request.kind,
      p_payload: request.payload,
    })
    .abortSignal(signal);
  if (error) throw toMapError(error);
  return commandResult.parse(data);
};

// The server derives the inverse from its immutable operation snapshots.
export const applyMapHistory: HistoryAction = async (request, signal) => {
  const { data, error } = await client()
    .rpc('apply_map_history', {
      p_map_id: request.mapId,
      p_operation_id: request.operationId,
      p_editor_session_id: request.editorSessionId,
      p_expected_revision: request.expectedRevision,
      p_mode: request.mode,
      p_target_operation_id: request.targetOperationId,
    })
    .abortSignal(signal);
  if (error) throw toMapError(error);
  return commandResult.parse(data);
};

export type CopyRequest = {
  sourceMapId: string;
  operationId: string;
  editorSessionId: string;
  title: string;
  nodes: Pick<MapNode, 'id' | 'parentId' | 'text' | 'sortOrder'>[];
};
export async function createMapCopy(request: CopyRequest) {
  const { data, error } = await client()
    .rpc('create_map_copy', {
      p_source_map_id: request.sourceMapId,
      p_operation_id: request.operationId,
      p_editor_session_id: request.editorSessionId,
      p_title: request.title,
      p_nodes: request.nodes,
    })
    .abortSignal(AbortSignal.timeout(20_000));
  if (error) throw toMapError(error);
  return created.parse(data);
}

// Remote duplication deliberately sends no document, authors or project from the browser.
export async function duplicateMap(sourceMapId: string, operationId: string) {
  const { data, error } = await client()
    .rpc('duplicate_map', {
      p_source_map_id: sourceMapId,
      p_operation_id: operationId,
      p_editor_session_id: editorSessionId,
    })
    .abortSignal(AbortSignal.timeout(20_000));
  if (error) throw toMapError(error);
  return created.parse(data);
}

export async function importMapBackup(backup: PortableBackup, operationId: string) {
  const { data, error } = await client()
    .rpc('import_map_backup', {
      p_operation_id: operationId,
      p_editor_session_id: editorSessionId,
      p_backup: backup,
    })
    .abortSignal(AbortSignal.timeout(20_000));
  if (error) throw toMapError(error);
  return created.parse(data);
}
