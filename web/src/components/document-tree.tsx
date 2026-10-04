import { archiveLimits } from '../archive-settings.ts';
import { archiveSession } from '../archive-sessions.ts';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { api } from '../api.ts';
import { currentFile, openTab, openArchiveEntry, archiveEntry, archiveChain } from '../stores.ts';
import { documentPreviewUrl, documentOutlineSource } from '../readers/document-file.ts';
import { createMarkdownOutlineSource } from '../readers/markdown-source.ts';
import { loadArchiveFile, releaseArchiveFile, type ArchiveDocument } from '../archive-file.ts';
import { fileTargetKey, fileTargetName, type ArchiveLocation } from '../file-target.ts';
import { parseMarkdownDocument, isMarkdownFile } from '../markdown.ts';
import type { OutlineSource, OutlineSourceFactory, OutlineState } from '../readers/outline-source.ts';
import { navigateReaderOutline } from '../readers/navigation.ts';
import { DocumentOutlineTree } from './document-outline-tree.tsx';

/** Application connector; future reader formats can supply the same outline-source contract. */
export default function DocumentTree(props: { path: string; archive?: ArchiveLocation; reload?: number; source?: OutlineSourceFactory }) {
  const selectedFile = () => currentFile() === props.path && (props.archive
    ? archiveEntry() === props.archive.entry && JSON.stringify(archiveChain()) === JSON.stringify(props.archive.chain)
    : !archiveEntry() && !archiveChain().length);
  const [state, setState] = createSignal<OutlineState>({ outline: [], outlineStatus: 'loading', password: null });
  const [revision, setRevision] = createSignal(0), [error, setError] = createSignal(false);
  const [selected, setSelected] = createSignal<string>();
  const [archiveFailure, setArchiveFailure] = createSignal(false);
  let active = true, navigation = 0;
  onCleanup(() => { active = false; });
  createEffect(() => {
    if (props.archive) archiveLimits();
    revision(); props.reload;
    const path = props.path, location = props.archive, customSource = props.source;
    let document: ArchiveDocument | undefined;
    let disposed = false, source: OutlineSource | undefined, unsubscribe: (() => void) | undefined;
    const release = () => { unsubscribe?.(); unsubscribe = undefined; source?.release(); source = undefined; if (document) releaseArchiveFile(document); document = undefined; };
    setState({ outline: [], outlineStatus: 'loading', password: null }); setArchiveFailure(false); setError(false); setSelected(undefined);
    void (async () => {
      if (location) {
        document = await loadArchiveFile(path, location.chain, location.entry);
        if (disposed) { release(); return; }
        if (isMarkdownFile(fileTargetName(props))) {
          setState({ outline: parseMarkdownDocument(document.content ?? '').outline, outlineStatus: 'ready', password: null });
          release(); return;
        }
        const acquire = customSource ?? (await documentOutlineSource(fileTargetName(props)));
        if (disposed) { release(); return; }
        source = acquire(document.url);
      } else if (isMarkdownFile(path) && !customSource) {
        source = createMarkdownOutlineSource(path);
      } else {
        const info = await api.fileInfo(path);
        const acquire = customSource ?? (await documentOutlineSource(fileTargetName(props)));
        if (disposed) return;
        source = acquire(documentPreviewUrl(path, info));
      }
      unsubscribe = source.subscribe((state) => {
        if (disposed) return;
        setState(state);
        // Keep only lightweight outline data after scanning; no idle document workers or rendered chapters.
        if (state.outlineStatus === 'ready' || state.outlineStatus === 'error') queueMicrotask(release);
      });
    })().catch((error) => {
      release();
      if (!disposed) {
        setArchiveFailure(!!location && !!error?.message && archiveSession(path, location.chain)?.error === error.message);
        setState({ outline: [], outlineStatus: 'error', password: null });
      }
    });
    onCleanup(() => { disposed = true; release(); });
  });
  const open = async (id?: string) => {
    const request = ++navigation;
    setError(false);
    try {
      if (props.archive) await openArchiveEntry(props.path, props.archive.entry, props.archive.chain);
      else await openTab(props.path);
      if (request !== navigation || !selectedFile()) return;
      if (id !== undefined) {
        if (active) setSelected(id);
        navigateReaderOutline(fileTargetKey(props), id, () => { if (active) { setError(true); setSelected(undefined); } });
      }
    } catch { if (active) setError(true); }
  };
  return <Show when={!archiveFailure()}><DocumentOutlineTree state={state()} selected={selectedFile() ? selected() : undefined}
    navigate={(id) => void open(id)} open={() => void open()} retry={() => setRevision(revision() + 1)} error={error()}/></Show>;
}
