import type { ReaderController } from './types.ts';

// Application handoff only. The reader and outline views do not import file/tab stores.
const readers = new Map<string, Pick<ReaderController, 'goToOutline'>>();
let pending: { path: string; id: string; failed(): void } | undefined;
let generation = 0;
function dispatch() {
  if (!pending) return;
  const reader = readers.get(pending.path);
  if (!reader?.goToOutline) return;
  const request = pending, current = generation;
  pending = undefined;
  void Promise.resolve().then(() => {
    if (current !== generation) return;
    return reader.goToOutline!(request.id);
  }).catch(() => { if (current === generation) request.failed(); });
}
export function navigateReaderOutline(path: string, id: string, failed: () => void) {
  generation++;
  pending = { path, id, failed };
  dispatch();
}
export function registerReaderNavigation(path: string, reader: Pick<ReaderController, 'goToOutline'>) {
  readers.set(path, reader); dispatch();
  return () => { if (readers.get(path) === reader) readers.delete(path); };
}
export function cancelReaderNavigation() { generation++; pending = undefined; }
