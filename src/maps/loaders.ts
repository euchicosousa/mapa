import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { z } from 'zod';
import { queryClient } from '../app/query-client';
import { readDraft, clearMapDrafts } from './drafts';
import { useEditorStore, type Recovery } from '../state/editor';
import { requireMember } from '../auth/access';
import { createMap, getMapDocument, MapError, mapId } from './api';

export async function libraryLoader(args: LoaderFunctionArgs) {
  const access = await requireMember(args);
  return { access };
}

const createForm = z.object({ operationId: z.uuid() });
const createErrors: Partial<Record<MapError['code'], string>> = {
  UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente para criar o mapa.',
  FORBIDDEN: 'Sua conta não pode criar mapas nesta equipe.',
  CONFLICT: 'Esta solicitação já foi usada. Recarregue a página e tente novamente.',
};
export async function createMapAction(args: ActionFunctionArgs) {
  const access = await requireMember(args);
  const parsed = createForm.safeParse(Object.fromEntries(await args.request.formData()));
  if (!parsed.success) return { error: 'Não foi possível criar o mapa. Recarregue a página e tente novamente.' };
  try {
    // A retry after a network failure resubmits the same operationId: no duplicate map.
    const result = await createMap(access.workspace.id, parsed.data.operationId);
    await queryClient.invalidateQueries({ queryKey: ['maps'], refetchType: 'none' });
    return redirect(`/mapas/${result.mapId}`);
  } catch (error) {
    const code = error instanceof MapError ? error.code : 'UNAVAILABLE';
    return { error: createErrors[code] ?? 'Não foi possível criar o mapa. Confira sua conexão e tente novamente.' };
  }
}

export type MapLoaderData = Awaited<ReturnType<typeof mapLoader>>;
export async function mapLoader(args: LoaderFunctionArgs) {
  const access = await requireMember(args);
  const id = mapId.safeParse(args.params.mapId);
  if (!id.success) return { kind: 'unavailable' as const };
  try {
    const document = await queryClient.fetchQuery({
      queryKey: ['map', access.userId, id.data],
      staleTime: 0,
      retry: false,
      queryFn: ({ signal }) => getMapDocument(id.data, signal),
    });
    let recovery: Recovery;
    try {
      const local = await readDraft({ userId: access.userId, workspaceId: access.workspace.id, mapId: id.data });
      recovery = { record: local.record, epoch: local.epoch, mapEpoch: local.mapEpoch };
    } catch {
      recovery = { record: null, epoch: 0, error: true };
    }
    return { kind: 'ready' as const, access, document, recovery };
  } catch (error) {
    if (error instanceof MapError && error.deleted) {
      const state = useEditorStore.getState();
      if (state.activeMapId === id.data && state.userId === access.userId) state.markDeleted();
      queryClient.removeQueries({ queryKey: ['map', access.userId, id.data] });
      try {
        const local = await readDraft({ userId: access.userId, workspaceId: access.workspace.id, mapId: id.data });
        return {
          kind: 'deleted' as const,
          access,
          record:
            local.record ?? (state.activeMapId === id.data && state.userId === access.userId ? state.snapshot() : null),
          storageError: false,
        };
      } catch {
        return {
          kind: 'deleted' as const,
          access,
          record: state.activeMapId === id.data && state.userId === access.userId ? state.snapshot() : null,
          storageError: true,
        };
      }
    }
    if (error instanceof MapError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
      if (useEditorStore.getState().activeMapId === id.data && useEditorStore.getState().userId === access.userId)
        useEditorStore.getState().revoke();
      await useEditorStore.getState().flushLocal();
      await clearMapDrafts({ userId: access.userId, workspaceId: access.workspace.id, mapId: id.data }).catch(() => {});
      queryClient.removeQueries({ queryKey: ['map', access.userId, id.data] });
      return { kind: 'unavailable' as const };
    }
    throw new Response(null, { status: 503 });
  }
}
