import { queryClient } from '../app/query-client';
import { useEditorStore } from '../state/editor';
let locked = false;
let generation = 0;
const listeners = new Set<() => void>();
export const privacySnapshot = () => locked;
export function subscribePrivacy(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function lockPrivateData() {
  generation += 1;
  locked = true;
  void queryClient.cancelQueries();
  queryClient.clear();
  useEditorStore.getState().reset();
  listeners.forEach((listener) => listener());
  return generation;
}
export function unlockPrivateData(ticket: number) {
  if (generation !== ticket) return;
  locked = false;
  listeners.forEach((listener) => listener());
}
