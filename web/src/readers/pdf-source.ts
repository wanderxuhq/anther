import { getDocument, GlobalWorkerOptions, PasswordResponses, version, type PDFDocumentProxy } from 'pdfjs-dist';
import type { ReaderOutlineItem } from './types.ts';
import type { OutlineState } from './outline-source.ts';

export const pdfAssets = `/pdfjs/${version}/`;
GlobalWorkerOptions.workerSrc = `${pdfAssets}pdf.worker.mjs`;

type PdfSource = {
  document: Promise<PDFDocumentProxy>;
  outlineReady: Promise<void>;
  destinations: Map<string, string | unknown[]>;
  subscribe(listener: (state: OutlineState) => void): () => void;
  unlock(password: string): void;
  release(): void;
};
type Session = Omit<PdfSource, 'release'> & { references: number; destroy(): void };
const sessions = new Map<string, Session>();

/** Share the parser/worker while the tree and reader use the same document. */
export function acquirePdfSource(url: string): PdfSource {
  let session = sessions.get(url);
  if (!session) {
    let state: OutlineState = { outline: [], outlineStatus: 'loading', password: null };
    let disposed = false, unlock: ((password: string) => void) | undefined;
    const listeners = new Set<(state: OutlineState) => void>();
    const destinations = new Map<string, string | unknown[]>();
    const update = (patch: Partial<OutlineState>) => {
      if (disposed) return;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    };
    const loading = getDocument({ url, cMapUrl: `${pdfAssets}cmaps/`, standardFontDataUrl: `${pdfAssets}standard_fonts/`,
      wasmUrl: `${pdfAssets}wasm/`, iccUrl: `${pdfAssets}iccs/`, disableStream: true, disableAutoFetch: true });
    loading.onPassword = (callback: (password: string) => void, reason: number) => {
      unlock = callback;
      update({ password: reason === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required' });
    };
    const outlineReady = loading.promise.then(async (document) => {
      const outline = await document.getOutline();
      if (disposed) return;
      const convert = (items: NonNullable<typeof outline>, prefix = ''): ReaderOutlineItem[] => items.map((item, index) => {
        const id = `${prefix}${index}`, destination = item.dest;
        const navigable = typeof destination === 'string' || Array.isArray(destination);
        if (navigable) destinations.set(id, destination);
        return { id, title: item.title, navigable, children: convert(item.items, `${id}.`) };
      });
      update({ outline: convert(outline ?? []), outlineStatus: 'ready', password: null });
    }).catch(() => { update({ outlineStatus: 'error' }); });
    session = { document: loading.promise, outlineReady, destinations, references: 0,
      subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
      unlock(password) { update({ password: null }); unlock?.(password); },
      destroy() { disposed = true; listeners.clear(); destinations.clear(); void loading.destroy().catch(() => {}); },
    };
    sessions.set(url, session);
  }
  const acquired = session;
  acquired.references++;
  let released = false;
  return { document: acquired.document, outlineReady: acquired.outlineReady, destinations: acquired.destinations,
    subscribe: acquired.subscribe, unlock: acquired.unlock,
    release() {
      if (released) return;
      released = true;
      // Allow a tree-to-reader handoff in the same turn, without retaining idle workers.
      queueMicrotask(() => {
        if (--acquired.references === 0) {
          if (sessions.get(url) === acquired) sessions.delete(url);
          acquired.destroy();
        }
      });
    },
  };
}
