import { api } from '../api.ts';
import { parseMarkdownDocument } from '../markdown.ts';
import type { OutlineSource, OutlineState } from './outline-source.ts';

export function createMarkdownOutlineSource(path: string): OutlineSource {
  const lifetime = new AbortController();
  let state: OutlineState = { outline: [], outlineStatus: 'loading', password: null };
  const listeners = new Set<(state: OutlineState) => void>();
  const update = (next: OutlineState) => {
    if (lifetime.signal.aborted) return;
    state = next;
    for (const listener of listeners) listener(state);
  };
  void api.readFile(path, lifetime.signal).then(({ content, utf8 }) => {
    if (lifetime.signal.aborted) return;
    if (!utf8) throw new Error('Not a text document');
    update({ outline: parseMarkdownDocument(content).outline, outlineStatus: 'ready', password: null });
  }).catch(() => update({ outline: [], outlineStatus: 'error', password: null }));
  return {
    subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    release() { lifetime.abort(); listeners.clear(); },
  };
}
