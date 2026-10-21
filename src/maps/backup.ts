import { z } from 'zod';
import type { MapNode } from './api';

export const BACKUP_MAX_BYTES = 2 * 1024 * 1024;
const text = (max: number) => z.string().refine(value => value.trim() !== '' && [...value].length <= max);
const portableNode = z.strictObject({
  id: z.uuid(), parentId: z.uuid().nullable(), text: text(500), sortOrder: z.number().int().min(0).max(2147483647),
});
// A finite, portable format. IDs relate nodes inside this file, never grant access.
export const portableBackupSchema = z.strictObject({
  format: z.literal('mapa-mental'), version: z.literal(1), exportedAt: z.iso.datetime(),
  hasPendingChanges: z.boolean(), map: z.strictObject({ title: text(120) }),
  nodes: z.array(portableNode).min(1).max(500),
}).superRefine((backup, context) => {
  const byId = new Map(backup.nodes.map(node => [node.id, node]));
  const roots = backup.nodes.filter(node => node.parentId === null);
  const fail = (message: string) => context.addIssue({ code: 'custom', message, path: ['nodes'] });
  if (byId.size !== backup.nodes.length) return fail('Há identificadores de nós repetidos.');
  if (roots.length !== 1) return fail('O mapa precisa ter exatamente um nó central.');
  const children = new Map<string, string[]>();
  for (const node of backup.nodes) {
    if (node.parentId === null) continue;
    if (!byId.has(node.parentId)) return fail('Há um nó cujo pai não existe neste mapa.');
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }
  const seen = new Set<string>(), queue = [{ id: roots[0].id, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (seen.has(current.id)) return fail('O mapa contém um ciclo.');
    if (current.depth > 30) return fail('O mapa ultrapassa 30 níveis de profundidade.');
    seen.add(current.id);
    for (const id of children.get(current.id) ?? []) queue.push({ id, depth: current.depth + 1 });
  }
  if (seen.size !== backup.nodes.length) fail('Há um ciclo ou ramo desconectado do nó central.');
});
export type PortableBackup = z.infer<typeof portableBackupSchema>;

export async function readPortableBackup(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<PortableBackup> {
  if (file.size > BACKUP_MAX_BYTES) throw new Error('O arquivo ultrapassa o limite de 2 MB.');
  if (file.size === 0) throw new Error('O arquivo está vazio.');
  let value: unknown;
  try {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > BACKUP_MAX_BYTES) throw new Error('size');
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new Error('Não foi possível ler o arquivo como JSON UTF-8 válido.'); }
  if (typeof value === 'object' && value !== null && 'format' in value && value.format !== 'mapa-mental') throw new Error('Formato não reconhecido. Selecione um backup portátil do Mapa; o arquivo de emergência é diferente.');
  if (typeof value === 'object' && value !== null && 'version' in value && value.version !== 1) throw new Error('Versão de backup não suportada. Use a versão 1.');
  const parsed = portableBackupSchema.safeParse(value);
  if (!parsed.success) {
    const treeIssue = parsed.error.issues.find(issue => issue.code === 'custom' && issue.path.length === 1);
    throw new Error(treeIssue?.message ?? 'Backup inválido. Confira os campos, IDs, título, textos e o limite de 500 nós.');
  }
  return parsed.data;
}

export function backupFilename(title: string, exportedAt: string) {
  const name = [...title.normalize('NFC').replace(/[^\p{L}\p{N}\p{M} _-]/gu, '-').replace(/\s+/g, '-').replace(/-+/g, '-')]
    .slice(0, 64).join('').replace(/^-+|-+$/g, '') || 'sem-titulo';
  return `mapa-${name}-${exportedAt.slice(0, 10)}.json`;
}

export function createPortableBackup(document: { title: string; nodes: readonly Pick<MapNode, 'id' | 'parentId' | 'text' | 'sortOrder'>[] }, hasPendingChanges: boolean, now = new Date()) {
  // Copy scalars synchronously, including the live text draft, before any access check.
  const parsed = portableBackupSchema.safeParse({
    format: 'mapa-mental', version: 1, exportedAt: now.toISOString(), hasPendingChanges,
    map: { title: document.title },
    nodes: document.nodes.map(({ id, parentId, text, sortOrder }) => ({ id, parentId, text, sortOrder })),
  });
  if (!parsed.success) {
    const treeIssue = parsed.error.issues.find(issue => issue.code === 'custom' && issue.path.length === 1);
    throw new Error(treeIssue?.message ?? 'Confira o título (1–120 caracteres) e os textos (1–500 caracteres, sem ficar em branco). Nenhum conteúdo foi cortado.');
  }
  const json = JSON.stringify(parsed.data, null, 2);
  if (new TextEncoder().encode(json).length > BACKUP_MAX_BYTES) throw new Error('O backup ultrapassa o limite de 2 MB.');
  return { backup: parsed.data, json, filename: backupFilename(parsed.data.map.title, parsed.data.exportedAt) };
}

export function downloadPortableBackup(file: ReturnType<typeof createPortableBackup>) {
  const url = URL.createObjectURL(new Blob([file.json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = file.filename;
  document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
