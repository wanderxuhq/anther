import type { OutlineState } from './outline-source.ts';
import { readEpubBook, type EpubBook } from './epub-data.ts';
import { prepareEpubChapter, type EpubChapter } from './epub-content.ts';

type EpubSource = {
  book: Promise<EpubBook>;
  chapter(index: number, signal?: AbortSignal): Promise<EpubChapter>;
  subscribe(listener: (state: OutlineState) => void): () => void;
  release(): void;
};
type Session = Omit<EpubSource, 'release'> & { references: number; destroy(): void };
const sessions = new Map<string, Session>();

/** Shared client-side ZIP/metadata session. Chapters and their resources are read on demand. */
export function acquireEpubSource(url: string): EpubSource {
  let session = sessions.get(url);
  if (!session) {
    const worker = new Worker(new URL('./epub-zip.worker.ts', import.meta.url), { type: 'module' });
    let sequence = 0, disposed = false, broken: Error | undefined;
    const requests = new Map<number, { resolve(value: { paths: string[]; bytes: Uint8Array<ArrayBuffer> }): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    const fail = (error: Error) => { for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(error); } requests.clear(); };
    worker.onmessage = ({ data }) => {
      const pending = requests.get(data.id);
      if (!pending) return;
      requests.delete(data.id); clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data);
    };
    const stop = (error: Error) => { broken = error; fail(error); worker.terminate(); };
    worker.onerror = () => stop(new Error('EPUB worker failed'));
    const request = (args: { url?: string; path?: string; limit?: number }) => new Promise<{ paths: string[]; bytes: Uint8Array<ArrayBuffer> }>((resolve, reject) => {
      if (disposed || broken) { reject(broken ?? new Error('Cancelled')); return; }
      const id = ++sequence;
      const timer = setTimeout(() => stop(new Error('EPUB read timed out')), 60_000);
      requests.set(id, { resolve, reject, timer }); worker.postMessage({ id, ...args });
    });
    const read = async (path: string, limit: number) => (await request({ path, limit })).bytes;
    const listeners = new Set<(state: OutlineState) => void>();
    let state: OutlineState = { outline: [], outlineStatus: 'loading', password: null };
    const update = (patch: Partial<OutlineState>) => { if (!disposed) { state = { ...state, ...patch }; listeners.forEach((listener) => listener(state)); } };
    const book = request({ url }).then(({ paths }) => readEpubBook(async (path) => new TextDecoder().decode(await read(path, 4 * 1024 * 1024)), new Set(paths)));
    void book.then((value) => update({ outline: value.outline, outlineStatus: 'ready' })).catch(() => update({ outlineStatus: 'error' }));
    session = { book, references: 0,
      async chapter(index, signal) {
        const metadata = await book;
        signal?.throwIfAborted();
        const value = await prepareEpubChapter(metadata, index, async (path, limit) => {
          signal?.throwIfAborted();
          const data = await read(path, limit);
          signal?.throwIfAborted();
          return data;
        });
        if (disposed || signal?.aborted) { value.release(); throw new Error('Cancelled'); }
        return value;
      },
      subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
      destroy() { disposed = true; fail(new Error('Cancelled')); worker.terminate(); listeners.clear(); },
    };
    sessions.set(url, session);
  }
  const acquired = session; acquired.references++;
  let released = false;
  return { book: acquired.book, chapter: acquired.chapter, subscribe: acquired.subscribe,
    release() {
      if (released) return; released = true;
      queueMicrotask(() => { if (--acquired.references === 0) { if (sessions.get(url) === acquired) sessions.delete(url); acquired.destroy(); } });
    },
  };
}
