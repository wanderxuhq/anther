import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { archiveChildren, isArchiveFile, type ArchiveEntry } from '../archive.ts';
import { archiveSession, cancelArchive, downloadArchiveEntry, ensureArchive } from '../archive-sessions.ts';
import { archiveChain, archiveEntry, currentFile, openArchiveEntry } from '../stores.ts';
import { archiveLimits } from '../archive-settings.ts';
import { t } from '../i18n.ts';
import { ArchiveFeedback } from './archive-feedback.tsx';

function Branch(props: { archive: string; directory: string; chain: string[] }) {
  const [limit, setLimit] = createSignal(200);
  const children = createMemo(() => archiveChildren(archiveSession(props.archive, props.chain)?.entries ?? [], props.directory, limit() + 1));
  return <><For each={children().slice(0, limit())}>{(entry) => <Entry archive={props.archive} chain={props.chain} entry={entry} />}</For>
    <Show when={children().length > limit()}><button class="menu-item" onClick={() => setLimit((value) => value + 200)}>{t('archive.more')}</button></Show>
  </>;
}

function Entry(props: { archive: string; entry: ArchiveEntry; chain: string[] }) {
  const nested = () => !props.entry.directory && !props.entry.link && isArchiveFile(props.entry.path);
  const atChain = () => props.chain.every((name, index) => archiveChain()[index] === name);
  const selected = () => currentFile() === props.archive && atChain() && (nested()
    ? archiveChain().length === props.chain.length + 1 && archiveChain()[props.chain.length] === props.entry.path && !archiveEntry()
    : archiveChain().length === props.chain.length && archiveEntry() === props.entry.path);
  const [expanded, setExpanded] = createSignal(false), [menu, setMenu] = createSignal(false);
  const [downloadPending, setDownloadPending] = createSignal(false);
  const state = () => archiveSession(props.archive, props.chain);
  createEffect(() => {
    if (currentFile() !== props.archive || !atChain()) return;
    const name = archiveChain()[props.chain.length] ?? archiveEntry();
    if (name?.startsWith(`${props.entry.path}/`) || (nested() && name === props.entry.path)) setExpanded(true);
  });
  const download = async (password?: string) => {
    if (password !== undefined) await ensureArchive(props.archive, password, true, props.chain).catch(() => {});
    setDownloadPending(true);
    try { await downloadArchiveEntry(props.archive, props.entry.path, props.chain); setDownloadPending(false); }
    catch { /* Inline feedback offers password retry. */ }
  };
  return <div class="tree-node archive-node">
    <div class={`tree-row ${selected() ? 'active' : ''}`} title={`${props.archive} › ${props.entry.path}`} onClick={() => {
      setMenu(false);
      if (props.entry.directory) setExpanded((value) => !value);
      else {
        if (state()?.busy) cancelArchive(props.archive);
        void openArchiveEntry(props.archive, nested() ? null : props.entry.path, nested() ? [...props.chain, props.entry.path] : props.chain).catch(() => {});
      }
    }}>
      <span class="tree-arrow" onClick={(event) => { if (nested()) { event.stopPropagation(); setExpanded((value) => !value); } }}>{props.entry.directory || nested() ? expanded() ? '▾' : '▸' : ''}</span>
      <span class="tree-name">{props.entry.path.split('/').pop()}</span>
      <span class="archive-readonly" title={t('archive.readonly')} aria-label={t('archive.readonly')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10" width="12" height="10" rx="2"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg>
      </span>
      <Show when={!props.entry.directory && !props.entry.link}>
        <div class="tree-row-actions"><button class="icon-btn row-menu-btn" title={t('filetree.actions')} onClick={(e) => { e.stopPropagation(); setMenu((value) => !value); }}>⋯</button>
          <Show when={menu()}><div class="row-menu" onClick={(e) => e.stopPropagation()}><button class="menu-item" disabled={!!state()?.busy} onClick={() => { setMenu(false); void download(); }}>{t('filetree.download')}</button></div></Show>
        </div>
      </Show>
    </div>
    <Show when={downloadPending() && state()?.passwordRequired}><ArchiveFeedback path={props.archive} chain={props.chain} retry={(password) => void download(password)} /></Show>
    <Show when={props.entry.directory && expanded()}><div class="tree-children"><Branch archive={props.archive} chain={props.chain} directory={props.entry.path} /></div></Show>
    <Show when={nested() && expanded()}><ArchiveTree path={props.archive} chain={[...props.chain, props.entry.path]} /></Show>
  </div>;
}

export default function ArchiveTree(props: { path: string; chain?: string[] }) {
  const chain = () => props.chain ?? [];
  const state = () => archiveSession(props.path, chain());
  createEffect(on([() => props.path, () => props.chain, archiveLimits], () => { void ensureArchive(props.path, undefined, false, chain()).catch(() => {}); }));
  onCleanup(() => { if (currentFile() !== props.path) cancelArchive(props.path); });
  return <div class="tree-children archive-tree">
    <Show when={!state()?.passwordRequired || !state()?.entries}><ArchiveFeedback path={props.path} chain={chain()} /></Show>
    <Show when={chain().length + 1 <= archiveLimits().maxDepth}><Branch archive={props.path} chain={chain()} directory="" /></Show>
    <Show when={state()?.entries?.length === 0}><span class="archive-empty">{t('archive.empty')}</span></Show>
  </div>;
}
