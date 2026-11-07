import { createEffect, createMemo, createSignal, For, lazy, Suspense, ErrorBoundary, on, onCleanup, Show } from 'solid-js';
import { archiveChildren, isArchiveFile, type ArchiveEntry } from '../archive.ts';
import { archiveSession, cancelArchive, downloadArchiveEntry, ensureArchive } from '../archive-sessions.ts';
import { archiveChain, archiveEntry, openArchiveEntry, activeArchiveRoot, tabs } from '../stores.ts';
import { archiveLimits } from '../archive-settings.ts';
import { t } from '../i18n.ts';
import { hasDocumentOutline } from '../readers/document-file.ts';
import { isDatabaseFile } from '../database/source.ts';
const DatabaseTree = lazy(() => import('./database-tree.tsx'));
const DocumentTree = lazy(() => import('./document-tree.tsx'));
import { ArchiveFeedback } from './archive-feedback.tsx';
import { Icon } from './icons.tsx';

function Branch(props: { archive: string; directory: string; chain: string[] }) {
  const [limit, setLimit] = createSignal(200);
  const children = createMemo(() => archiveChildren(archiveSession(props.archive, props.chain)?.entries ?? [], props.directory, limit() + 1));
  return <><For each={children().slice(0, limit())}>{(entry) => <Entry archive={props.archive} chain={props.chain} entry={entry} />}</For>
    <Show when={children().length > limit()}><button class="menu-item" onClick={() => setLimit((value) => value + 200)}>{t('archive.more')}</button></Show>
  </>;
}

function Entry(props: { archive: string; entry: ArchiveEntry; chain: string[] }) {
  const database = () => !props.entry.directory && !props.entry.link && (isDatabaseFile(props.entry.path) || tabs().some((tab) => tab.kind === 'database' && tab.path === props.archive && tab.archive?.entry === props.entry.path && JSON.stringify(tab.archive.chain) === JSON.stringify(props.chain)));
  const document = () => !props.entry.directory && !props.entry.link && hasDocumentOutline(props.entry.path);
  const nested = () => !props.entry.directory && !props.entry.link && isArchiveFile(props.entry.path);
  const atChain = () => props.chain.every((name, index) => archiveChain()[index] === name);
  const selected = () => activeArchiveRoot() === props.archive && atChain() && (nested()
    ? archiveChain().length === props.chain.length + 1 && archiveChain()[props.chain.length] === props.entry.path && !archiveEntry()
    : archiveChain().length === props.chain.length && archiveEntry() === props.entry.path);
  const [expanded, setExpanded] = createSignal(false), [menu, setMenu] = createSignal(false);
  const [documentRevision, setDocumentRevision] = createSignal(0);
  const [downloadPending, setDownloadPending] = createSignal(false);
  const state = () => archiveSession(props.archive, props.chain);
  createEffect(() => {
    if (activeArchiveRoot() !== props.archive || !atChain()) return;
    const name = archiveChain()[props.chain.length] ?? archiveEntry();
    if (name?.startsWith(`${props.entry.path}/`) || ((nested() || database()) && name === props.entry.path)) setExpanded(true);
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
        void openArchiveEntry(props.archive, nested() ? null : props.entry.path, nested() ? [...props.chain, props.entry.path] : props.chain).catch(() => {});
      }
    }}>
      <span class="tree-arrow"><Show when={nested() || document() || database()} fallback={props.entry.directory ? <Icon name={expanded() ? 'chevron-down' : 'chevron-right'} size={14} /> : ''}>
        <button class="archive-toggle" title={t(database() ? 'database.expand' : document() ? 'reader.expandOutline' : 'archive.expand')} aria-label={t(database() ? 'database.expand' : document() ? 'reader.expandOutline' : 'archive.expand')}
          aria-expanded={expanded()} onClick={(event) => { event.stopPropagation(); setExpanded(!expanded()); }}><Icon name={expanded() ? 'chevron-down' : 'chevron-right'} size={14} /></button>
      </Show></span>
      <span class="tree-name">{props.entry.path.split('/').pop()}</span>
      <span class="archive-readonly" title={t('archive.readonly')} aria-label={t('archive.readonly')}>
        <Icon name="lock" size={16} />
      </span>
      <Show when={!props.entry.directory && !props.entry.link}>
        <div class="tree-row-actions"><button class="icon-btn row-menu-btn" title={t('filetree.actions')} aria-label={t('filetree.actions')} onClick={(e) => { e.stopPropagation(); setMenu((value) => !value); }}><Icon name="more" size={18} /></button>
          <Show when={menu()}><div class="row-menu" onClick={(e) => e.stopPropagation()}><button class="menu-item" disabled={!!state()?.busy} onClick={() => { setMenu(false); void download(); }}>{t('filetree.download')}</button></div></Show>
        </div>
      </Show>
    </div>
    <Show when={downloadPending() && (state()?.passwordRequired || state()?.error)}><ArchiveFeedback path={props.archive} chain={props.chain} entry={props.entry.path} priority={40} retry={(password) => void download(password)} /></Show>
    <Show when={props.entry.directory && expanded()}><div class="tree-children"><Branch archive={props.archive} chain={props.chain} directory={props.entry.path} /></div></Show>
    <Show when={(document() || database()) && expanded()}>
      <ArchiveFeedback path={props.archive} chain={props.chain} entry={props.entry.path} priority={20} retry={(password) => {
        void ensureArchive(props.archive, password, true, props.chain).then(() => setDocumentRevision(documentRevision() + 1)).catch(() => {});
      }}/>
      <ErrorBoundary fallback={<div class="error-banner">{t('reader.outlineFailed')}</div>}>
        <Suspense fallback={<div role="status">{t('loading')}</div>}><Show when={database()} fallback={<DocumentTree path={props.archive} reload={documentRevision()} archive={{ entry: props.entry.path, chain: props.chain }}/>}>
          <DatabaseTree path={props.archive} reload={documentRevision()} archive={{ entry: props.entry.path, chain: props.chain }}/>
        </Show></Suspense>
      </ErrorBoundary>
    </Show>
    <Show when={nested() && expanded()}><ArchiveTree path={props.archive} chain={[...props.chain, props.entry.path]} /></Show>
  </div>;
}

export default function ArchiveTree(props: { path: string; chain?: string[] }) {
  const chain = () => props.chain ?? [];
  const state = () => archiveSession(props.path, chain());
  createEffect(on([() => props.path, () => props.chain, archiveLimits], () => { void ensureArchive(props.path, undefined, false, chain()).catch(() => {}); }));
  onCleanup(() => { if (activeArchiveRoot() !== props.path) cancelArchive(props.path); });
  return <div class="tree-children archive-tree">
    <Show when={!state()?.passwordRequired || !state()?.entries}><ArchiveFeedback path={props.path} chain={chain()} /></Show>
    <Show when={chain().length + 1 <= archiveLimits().maxDepth}><Branch archive={props.path} chain={chain()} directory="" /></Show>
    <Show when={state()?.entries?.length === 0}><span class="archive-empty">{t('archive.empty')}</span></Show>
  </div>;
}
