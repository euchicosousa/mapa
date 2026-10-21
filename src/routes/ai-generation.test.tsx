import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AIGenerationControls } from './ai-generation';
import { useEditorStore } from '../state/editor';
import { editorSessionId, MapError, type MapDocument } from '../maps/api';
import * as ai from '../maps/ai';
vi.mock('../maps/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../maps/ai')>()),
  aiAvailable: vi.fn(),
  getAI: vi.fn(),
  startAI: vi.fn(),
  cancelAI: vi.fn(),
}));
const user = '00000000-0000-4000-8000-000000000001',
  root = '00000000-0000-4000-8000-000000000002',
  map = '00000000-0000-4000-8000-000000000003';
const doc: MapDocument = {
  map: {
    id: map,
    workspaceId: user,
    title: 'Mapa',
    ownerId: user,
    ownerName: 'Pessoa',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  },
  nodes: [
    {
      id: root,
      parentId: null,
      text: 'Ideia central',
      sortOrder: 0,
      createdBy: user,
      updatedBy: user,
      source: 'manual',
    },
  ],
  people: { [user]: 'Pessoa' },
};
let remote: ai.AIGeneration | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  remote = null;
  useEditorStore.getState().load(doc, user);
  vi.mocked(ai.aiAvailable).mockResolvedValue({ enabled: true, code: null });
  vi.mocked(ai.getAI).mockImplementation(async () => remote);
  vi.mocked(ai.startAI).mockImplementation(async (request) => {
    remote = {
      id: request.generationId,
      mapId: map,
      parentNodeId: root,
      editorSessionId,
      state: 'running',
      errorCode: null,
      result: null,
    };
    return remote;
  });
});
afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
});
async function start() {
  render(<AIGenerationControls nodeId={root} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gerar caminhos com IA' }));
  await screen.findByRole('button', { name: 'Cancelar geração' });
}
it('cancels the same generation and keeps all existing text/nodes', async () => {
  vi.mocked(ai.cancelAI).mockImplementation(async () => {
    remote = { ...remote!, state: 'cancelled' };
    return remote;
  });
  await start();
  const id = remote!.id;
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar geração' }));
  await screen.findByText('Geração cancelada. Nenhum filho foi inserido.');
  expect(ai.cancelAI).toHaveBeenCalledWith(map, id);
  expect(useEditorStore.getState().nodes).toEqual(doc.nodes);
  expect(ai.startAI).toHaveBeenCalledOnce();
});
it('late cancellation reports applied, preserves later edits and never undoes them automatically', async () => {
  await start();
  const id = remote!.id;
  const result = {
    operationId: id,
    revision: 2,
    changedNodes: [],
    deletedNodeIds: [],
    mapPatch: { revision: 2, updatedBy: user, updatedAt: '' },
  };
  useEditorStore.setState({
    confirmed: {
      ...doc,
      map: { ...doc.map, revision: 3 },
      nodes: [{ ...doc.nodes[0], text: 'Minha edição posterior' }],
    },
    nodes: [{ ...doc.nodes[0], text: 'Minha edição posterior' }],
    undoStack: [{ operationId: id }, { operationId: 'later' }],
  });
  vi.mocked(ai.cancelAI).mockImplementation(async () => {
    remote = { ...remote!, state: 'applied', result };
    return remote;
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar geração' }));
  await screen.findByText('A geração já foi aplicada antes do cancelamento. Os quatro caminhos permanecem no mapa.');
  expect(screen.getByRole('button', { name: 'Desfazer geração' })).toBeDisabled();
  expect(useEditorStore.getState().nodes[0].text).toBe('Minha edição posterior');
  expect(useEditorStore.getState().undoStack).toHaveLength(2);
});
it('a lost cancel response can be retried safely without a new paid generation', async () => {
  vi.mocked(ai.cancelAI)
    .mockRejectedValueOnce(Error('response lost'))
    .mockImplementationOnce(async () => {
      remote = { ...remote!, state: 'cancelled' };
      return remote;
    });
  await start();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar geração' }));
  await screen.findByRole('button', { name: 'Tentar cancelar a mesma geração' });
  fireEvent.click(screen.getByRole('button', { name: 'Tentar cancelar a mesma geração' }));
  await screen.findByText('Geração cancelada. Nenhum filho foi inserido.');
  expect(ai.cancelAI).toHaveBeenCalledTimes(2);
  expect(vi.mocked(ai.cancelAI).mock.calls[0]).toEqual(vi.mocked(ai.cancelAI).mock.calls[1]);
  expect(ai.startAI).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('a deleted-map status preserves the recovery draft instead of classifying it as revocation', async () => {
  useEditorStore.getState().typeText(root, '  ');
  vi.mocked(ai.getAI).mockRejectedValue(new MapError('NOT_FOUND', true));
  render(<AIGenerationControls nodeId={root} />);
  await waitFor(() => expect(useEditorStore.getState().deleted).toBe(true));
  expect(useEditorStore.getState().draft?.text).toBe('  ');
});
it('a revoked status hides the document and clears the local editor', async () => {
  useEditorStore.getState().typeText(root, '  ');
  vi.mocked(ai.getAI).mockRejectedValue(new MapError('NOT_FOUND'));
  render(<AIGenerationControls nodeId={root} />);
  await waitFor(() => expect(useEditorStore.getState().revoked).toBe(true));
  expect(useEditorStore.getState().nodes).toHaveLength(0);
  expect(useEditorStore.getState().draft).toBeNull();
});

it('a quota rejection leaves editing intact and never retries a paid call automatically', async () => {
  vi.mocked(ai.startAI).mockRejectedValue(new ai.AIError('AI_RATE_LIMIT', 1));
  render(<AIGenerationControls nodeId={root} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gerar caminhos com IA' }));
  await screen.findByText(ai.aiErrorText.AI_RATE_LIMIT);
  expect(screen.getByRole('button', { name: 'Gerar caminhos com IA' })).toBeDisabled();
  useEditorStore.getState().typeText(root, '  ');
  expect(useEditorStore.getState().draft?.text).toBe('  ');
  expect(ai.startAI).toHaveBeenCalledOnce();
});
it('configuration missing has a distinct message and availability check never starts a generation', async () => {
  vi.mocked(ai.aiAvailable).mockResolvedValue({ enabled: false, code: 'AI_CONFIG_MISSING' });
  render(<AIGenerationControls nodeId={root} />);
  await screen.findByText(ai.aiErrorText.AI_CONFIG_MISSING);
  fireEvent.click(screen.getByRole('button', { name: 'Consultar disponibilidade da IA' }));
  await waitFor(() => expect(ai.aiAvailable).toHaveBeenCalledTimes(2));
  expect(ai.startAI).not.toHaveBeenCalled();
});
