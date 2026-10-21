import type { AIGeneration } from './ai';

// One status read at a time; visibility resumes immediately, including after a
// transient failed read on reload. This watcher never starts a paid generation.
export function watchGeneration(options: {
  read: () => Promise<AIGeneration | null>;
  receive: (job: AIGeneration) => boolean;
  pending: () => boolean;
  failure?: (error: unknown) => boolean;
  visibility?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
}) {
  const visibility = options.visibility ?? document;
  let disposed = false,
    reading = false,
    refreshRequested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    if (disposed || visibility.hidden) return;
    if (reading) {
      refreshRequested = true;
      return;
    }
    reading = true;
    let keepReading = false,
      retryAllowed = true;
    void options
      .read()
      .then((job) => {
        if (!disposed && job) keepReading = options.receive(job);
      })
      .catch((error) => {
        if (!disposed) {
          keepReading = options.failure?.(error) ?? true;
          retryAllowed = keepReading;
        }
      })
      .finally(() => {
        reading = false;
        if (disposed || !retryAllowed) return;
        if (refreshRequested) {
          refreshRequested = false;
          refresh();
        } else if (!visibility.hidden && (keepReading || options.pending())) timer = setTimeout(refresh, 1000);
      });
  };
  const changed = () => {
    clearTimeout(timer);
    if (!visibility.hidden) refresh();
  };
  visibility.addEventListener('visibilitychange', changed);
  refresh();
  return {
    refresh,
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      visibility.removeEventListener('visibilitychange', changed);
    },
  };
}

export function acceptGeneration(previous: AIGeneration | null, incoming: AIGeneration) {
  if (previous?.id === incoming.id && !['pending', 'running'].includes(previous.state)) return previous;
  return incoming;
}
