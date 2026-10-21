import { useEditorStore } from './editor';

export function hasPendingEdits() {
  const state = useEditorStore.getState();
  return Boolean(
    state.confirmed &&
    (state.queue.length ||
      state.draft ||
      state.inFlight ||
      state.historyBusy ||
      state.pendingHistory ||
      state.undoRequested ||
      state.copyRequest ||
      state.needsHeadCheck ||
      state.status === 'conflict' ||
      !state.storageInitialized),
  );
}
export async function synchronizeEditor() {
  const store = useEditorStore;
  if (!store.getState().storageInitialized && !(await store.getState().retryStorage())) return false;
  store.getState().retry();
  if (store.getState().status === 'saved') return true;
  if (['error', 'conflict'].includes(store.getState().status) || store.getState().draft) return false;
  return new Promise<boolean>((resolve) => {
    const done = (saved: boolean) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(saved);
    };
    const unsubscribe = store.subscribe((state) => {
      if (state.status === 'saved') done(true);
      else if (state.status === 'error' || state.status === 'conflict') done(false);
    });
    const timer = setTimeout(() => done(false), 25_000);
  });
}

export function connectDraftLifecycle() {
  const flush = () => {
    useEditorStore.getState().commitText();
    void useEditorStore.getState().flushLocal();
  };
  const hidden = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('blur', flush);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    window.removeEventListener('blur', flush);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', hidden);
  };
}
