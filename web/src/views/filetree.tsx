import { withFileMutation } from '../file-operations.ts';
// web/src/views/filetree.tsx
// 文件树视图：懒加载目录（点击展开/收起）、文件点击打开、当前文件高亮。
//
// 响应式方案（偏离 brief 参考实现的「可变 Node + setRoot({...root()!}) 强制刷新」）：
// Solid 不追踪对普通对象属性的直接修改，且 For 对相同数组引用不做 diff、
// TreeNode 的 props 非响应式，顶层信号变化不会让已挂载子树重渲染。
// 因此把目录状态放进 createStore（solid-js/store，solid-js 自带，零新增依赖），
// 按 path 存取：
//   nodes[path] → { expanded, loaded?, loading? }   （'.' 为根目录键）
// 渲染时在组件作用域内直接读 nodes[path]（响应式），更新时 setNodes 精确命中该 path，
// 每次展开/收起只触发对应子树重渲染。
import { createEffect, createSignal, ErrorBoundary, For, lazy, Show, Suspense, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api, type DirEntry } from '../api.ts';
import { archiveChain, archiveEntry, activeArchiveRoot, currentFile, activeTab, openDatabaseTab, relocateFileTabs, openTab, tabs, setActivePanel, setDrawerOpen, pushState } from '../stores.ts';
import { parentOf } from '../paths.ts';
import { NameDialog, type DialogState } from '../components/name-dialog.tsx';
import { t } from '../i18n.ts';
import { preparingDownload, downloadProgressText, startDownload } from '../download.ts';
import { isArchiveFile } from '../archive.ts';
import { hasDocumentOutline } from '../readers/document-file.ts';
import { entriesFromDataTransfer, entriesFromFiles, uploadEntries, type UploadEntry } from '../upload.ts';
const DocumentTree = lazy(() => import('../components/document-tree.tsx'));

import { isDatabaseFile } from '../database/source.ts';
import { DatabaseIcon } from '../components/database-icon.tsx';
const DatabaseTree = lazy(() => import('../components/database-tree.tsx'));

const ArchiveTree = lazy(() => import('../components/archive-tree.tsx'));

type DirState = { expanded: boolean; loaded?: DirEntry[]; loading?: boolean };

// path → 目录状态。渲染时 nodes[path] 是响应式读取，setNodes 精确更新。
const [nodes, setNodes] = createStore<{ [path: string]: DirState }>({});
const [error, setError] = createSignal<string | null>(null);
const [upload, setUpload] = createSignal<{ done: number; total: number } | null>(null);
const uploading = () => upload() !== null;
/** 拖拽文件悬停的目标路径（'.' 为根），用于高亮可放置位置。 */
const [dropTarget, setDropTarget] = createSignal<string | null>(null);

// ---- 文件管理（Task 16）：菜单 + 命名对话框 + 两击确认删除 ----
type MenuTarget = { path: string; kind: 'dir' | 'file' | 'root' };
const [menu, setMenu] = createSignal<MenuTarget | null>(null);
const [dialog, setDialog] = createSignal<DialogState | null>(null);
const [confirmDel, setConfirmDel] = createSignal<string | null>(null); // 两击确认删除
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

/** 根目录子项不带 './' 前缀：与 URL/currentFile 中的相对路径形式一致，保证高亮可匹配 */
function childPath(parent: string, name: string): string {
  return parent === '.' ? name : `${parent}/${name}`;
}

/** 终端里点开目录：切到文件面板并逐级展开到该目录。 */
export async function revealDirectory(path: string): Promise<void> {
  setActivePanel('files');
  setDrawerOpen(true);
  pushState();
  await ensureRoot();
  let parent = '.';
  for (const part of path.split('/').filter(Boolean)) {
    const child = childPath(parent, part);
    if (!nodes[child]?.loaded) {
      const { entries } = await api.list(child);
      setNodes(child, { expanded: true, loaded: entries });
    } else {
      setNodes(child, 'expanded', true);
    }
    parent = child;
  }
}

async function ensureRoot(): Promise<void> {
  if (nodes['.']?.loaded || nodes['.']?.loading) return;
  setNodes('.', { loading: true });
  try {
    const { entries } = await api.list('.');
    setNodes('.', { expanded: true, loaded: entries, loading: false });
    setError(null);
  } catch (e) {
    setNodes('.', { loading: false });
    setError((e as Error).message);
  }
}

// 只读仅控制编辑器内容（用户决策 2026-08-11）：文件树写操作不校验 roMode，随时可用
/** 操作完成后刷新父目录列表（保持 loaded 数组与磁盘一致） */
async function refreshParent(parent: string) {
  const { entries } = await api.list(parent);
  setNodes(parent, { loaded: entries });
}

function showMenu(target: MenuTarget) {
  clearTimeout(confirmTimer);
  setConfirmDel(null);
  setMenu(target);
}

// 新建：目录行 → 建在其内；文件行 → 建在其父目录；根 → 根下
function beginCreate(kind: 'file' | 'dir', target: MenuTarget) {
  const base = target.kind === 'dir' ? target.path : parentOf(target.path);
  setDialog({
    title: kind === 'file' ? t('filetree.newFile') : t('filetree.newDir'),
    initial: '',
    submitLabel: t('filetree.create'),
    onSubmit: (name) => void doCreate(kind, base, name),
  });
}

async function doCreate(kind: 'file' | 'dir', base: string, name: string) {
  setDialog(null); setMenu(null);
  const p = childPath(base, name); // 根级不带头 './'（childPath 约定），保证与 URL/currentFile 匹配
  try {
    if (kind === 'file') {
      // 独占创建（POST /api/create，服务端 O_EXCL）：重名 → 409 already exists（服务器文案），
      // 不清空既有文件；不设客户端守卫，服务器是重名裁决的唯一事实源
      await api.create(p);
    } else {
      await api.mkDir(p); // 服务端 fs.mkdir；重名 → 409 already exists
    }
    await refreshParent(base);
    if (kind === 'file') {
      await openTab(p); // 新建文件直接打开编辑（现有 openTab 含 front + 快照 + pushState）
    }
    setError(null);
  } catch (e) { setError((e as Error).message); }
}

function beginRename(target: MenuTarget) {
  setDialog({
    title: t('filetree.rename'),
    initial: target.path.split('/').pop() ?? '',
    submitLabel: t('filetree.rename'),
    onSubmit: (name) => void doRename(target, name),
  });
}

/** 拖拽事件里是否带文件（内部文本拖拽不处理）。 */
function isFileDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

async function startUpload(base: string, entries: UploadEntry[]): Promise<void> {
  if (entries.length === 0 || uploading()) return;
  setError(null);
  setUpload({ done: 0, total: entries.length });
  try {
    const result = await uploadEntries(base, entries, (done, total) => setUpload({ done, total }));
    await refreshParent(base);
    setNodes(base, 'expanded', true);
    if (result.failed.length > 0) {
      const first = result.failed[0];
      const name = first.path.split('/').pop() ?? first.path;
      setError(result.uploaded === 0 && result.failed.length === 1 && first.status === 409
        ? t('filetree.uploadExists', { name })
        : t('filetree.uploadFailed', { uploaded: result.uploaded, failed: result.failed.length, name }));
    }
  } catch (e) {
    setError((e as Error).message);
    await refreshParent(base).catch(() => { /* 目标目录可能已不存在 */ });
  } finally {
    setUpload(null);
  }
}

async function dropUpload(e: DragEvent, base: string): Promise<void> {
  if (!e.dataTransfer) return;
  try {
    await startUpload(base, await entriesFromDataTransfer(e.dataTransfer));
  } catch (err) {
    setError((err as Error).message);
  }
}

function UploadItem(props: { target: MenuTarget }) {
  let fileInput!: HTMLInputElement;
  let folderInput!: HTMLInputElement;
  const base = () => props.target.kind === 'dir' ? props.target.path : parentOf(props.target.path);
  const pick = (input: HTMLInputElement) => {
    // 先快照 FileList：部分浏览器在 value='' 后会把 input.files 清空。
    const entries = input.files ? entriesFromFiles(input.files) : [];
    input.value = ''; // 允许连续选择同一批文件
    setMenu(null);
    if (entries.length > 0) void startUpload(base(), entries);
  };
  return (
    <>
      <input ref={fileInput} type="file" hidden multiple onChange={(e) => pick(e.currentTarget)} />
      <input
        ref={(el) => { folderInput = el; el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); }}
        type="file" hidden multiple
        onChange={(e) => pick(e.currentTarget)}
      />
      <button class="menu-item" disabled={uploading()} onClick={() => fileInput.click()}>
        {t('filetree.uploadFile')}
      </button>
      <button class="menu-item" disabled={uploading()} onClick={() => folderInput.click()}>
        {t('filetree.uploadFolder')}
      </button>
    </>
  );
}

async function doRename(target: MenuTarget, name: string) {
  setDialog(null); setMenu(null);
  // 子路径统一 childPath(parentOf(target.path), name)：根级 'a.ts' → childPath('.', 'b.ts') = 'b.ts'
  const to = childPath(parentOf(target.path), name);
  if (to === target.path) return; // 同名重命名 = 取消，静默关闭
  try {
    await withFileMutation(target.path, async () => {
      await api.rename(target.path, to);
      await relocateFileTabs(target.path, to);
    });
    await refreshParent(parentOf(target.path));
    setError(null);
  } catch (e) { setError((e as Error).message); }
}

function onDeleteTap(target: MenuTarget) {
  if (confirmDel() !== target.path) {
    setConfirmDel(target.path); // 第一击：按钮变「确认删除？」（红），3s 内第二击生效
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => setConfirmDel(null), 3000);
    return;
  }
  setConfirmDel(null); setMenu(null);
  void (async () => {
    try {
      await withFileMutation(target.path, async () => {
        await api.del(target.path);
        await relocateFileTabs(target.path);
      });
      await refreshParent(parentOf(target.path));
      setError(null);
    } catch (e) { setError((e as Error).message); }
  })();
}

onCleanup(() => clearTimeout(confirmTimer));

function TreeNode(props: { path: string; entry: DirEntry }) {
  // props 对当前实例固定不变；所有可变状态都从 store 响应式读取
  const state = () => nodes[props.path];
  const isDir = props.entry.type === 'dir';
  const database = () => !isDir && !isArchiveFile(props.path) && (isDatabaseFile(props.path) || tabs().some((tab) => tab.kind === 'database' && tab.path === props.path));
  const [databaseExpanded, setDatabaseExpanded] = createSignal(false);
  createEffect(() => { const tab = activeTab(); if (tab?.kind === 'database' && tab.path === props.path) setDatabaseExpanded(true); });
  const document = !isDir && hasDocumentOutline(props.path);
  const [documentExpanded, setDocumentExpanded] = createSignal(false);
  const archive = !isDir && isArchiveFile(props.path);
  const [archiveExpanded, setArchiveExpanded] = createSignal(false);
  createEffect(() => { if (archive && activeArchiveRoot() === props.path) setArchiveExpanded(true); });
  const isCurrent = () => currentFile() === props.path && (!archive || (!archiveEntry() && archiveChain().length === 0));
  const expanded = () => state()?.expanded === true;
  const loaded = () => state()?.loaded;
  const loading = () => state()?.loading === true;

  const onToggle = async () => {
    if (state()?.expanded) {
      setNodes(props.path, 'expanded', false); // 收起（不丢弃已加载子列表，再展开时零请求）
      return;
    }
    if (state()?.loaded) {
      setNodes(props.path, 'expanded', true);
      return;
    }
    if (state()?.loading) return; // 防连点并发加载
    setNodes(props.path, { loading: true }); // 对象式 set 自动创建缺失 key；嵌套路径 set 对未点击过的目录会抛 TypeError
    try {
      const { entries } = await api.list(props.path);
      setNodes(props.path, { expanded: true, loaded: entries, loading: false });
      setError(null);
    } catch (e) {
      setNodes(props.path, { loading: false });
      setError((e as Error).message);
    }
  };

  const onRowClick = () => {
    setMenu(null); // 点击行任意位置关闭操作菜单（点 ⋯ 按钮会 stopPropagation，不走到这里）
    if (isDir) void onToggle();
    // 文件与 link 条目同待遇：点击走 openTab（服务器对损坏链接会 400，MVP 可接受）
    else if (database()) { setDatabaseExpanded(true); openDatabaseTab(props.path); }
    else void openTab(props.path).catch((e) => setError((e as Error).message));
  };

  return (
    <div class="tree-node">
      <div
        class={`tree-row ${isCurrent() ? 'active' : ''}`}
        classList={{ 'drop-target': dropTarget() === props.path }}
        onClick={onRowClick}
        title={props.path}
        onDragOver={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          setDropTarget(props.path);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          const next = e.relatedTarget;
          if (next instanceof Node && e.currentTarget.contains(next)) return; // 在行内子元素间移动不算离开
          if (dropTarget() === props.path) setDropTarget(null);
        }}
        onDrop={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(null);
          void dropUpload(e, isDir ? props.path : parentOf(props.path));
        }}
      >
        <span class="tree-arrow"><Show when={archive || database() || document} fallback={isDir ? (expanded() ? '▾' : '▸') : ''}>
          <button class="archive-toggle" title={t(database() ? 'database.expand' : document ? 'reader.expandOutline' : 'archive.expand')} aria-label={t(database() ? 'database.expand' : document ? 'reader.expandOutline' : 'archive.expand')} aria-expanded={database() ? databaseExpanded() : document ? documentExpanded() : archiveExpanded()} onClick={(e) => { e.stopPropagation(); if (database()) setDatabaseExpanded((value) => !value); else if (document) setDocumentExpanded((value) => !value); else setArchiveExpanded((value) => !value); }}>{(database() ? databaseExpanded() : document ? documentExpanded() : archiveExpanded()) ? '▾' : '▸'}</button>
        </Show></span>
        <Show when={archive}><svg class="archive-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h10l4 4v14H5zM11 3v3h2v3h-2v3h2v3h-2v3h2"/></svg></Show>
        <Show when={database()}><DatabaseIcon/></Show>
        <span class="tree-name">{props.entry.name}</span>
        <div class="tree-row-actions">
          <button
            class="icon-btn row-menu-btn"
            title={t('filetree.actions')}
            onClick={(e) => { e.stopPropagation(); showMenu({ path: props.path, kind: isDir ? 'dir' : 'file' }); }}
          >⋯</button>
          <Show when={menu()?.path === props.path}>
            <div class="row-menu" onClick={(e) => e.stopPropagation()}>
              <button class="menu-item" onClick={() => beginCreate('file', menu()!)}>{t('filetree.newFile')}</button>
              <UploadItem target={menu()!} />
              <button class="menu-item" onClick={() => beginCreate('dir', menu()!)}>{t('filetree.newDir')}</button>
              <button class="menu-item" disabled={preparingDownload()} onClick={() => {
                setMenu(null);
                setError(null);
                void startDownload(props.path, props.entry.type !== 'file').catch((e) => setError(t('download.failed', { msg: (e as Error).message })));
              }}>{t('filetree.download')}</button>
              <Show when={menu()?.kind !== 'root'}>
                <button class="menu-item" onClick={() => beginRename(menu()!)}>{t('filetree.rename')}</button>
                <button class={`menu-item ${confirmDel() === props.path ? 'danger' : ''}`} onClick={() => onDeleteTap(menu()!)}>
                  {confirmDel() === props.path ? t('filetree.confirmDelete') : t('filetree.delete')}
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <Show when={isDir && expanded() && loaded()}>
        <div class="tree-children">
          <For each={loaded() ?? []}>
            {(child) => (
              <TreeNode path={childPath(props.path, child.name)} entry={child} />
            )}
          </For>
        </div>
      </Show>
      <Show when={document && documentExpanded()}>
        <ErrorBoundary fallback={<div class="error-banner">{t('reader.outlineFailed')}</div>}>
          <Suspense fallback={<div class="tree-children" role="status">{t('loading')}</div>}><DocumentTree path={props.path}/></Suspense>
        </ErrorBoundary>
      </Show>
      <Show when={database() && databaseExpanded()}>
        <ErrorBoundary fallback={<div class="error-banner">{t('database.failed')}</div>}>
          <Suspense fallback={<div role="status">{t('loading')}</div>}><DatabaseTree path={props.path}/></Suspense>
        </ErrorBoundary>
      </Show>
      <Show when={archive && archiveExpanded()}>
        <ErrorBoundary fallback={<div class="error-banner">{t('archive.failed')}</div>}>
          <Suspense fallback={<div role="status">{t('archive.scanning')}</div>}><ArchiveTree path={props.path}/></Suspense>
        </ErrorBoundary>
      </Show>
    </div>
  );
}

export function FileTreeView() {
  void ensureRoot();

  return (
    <div
      class="filetree"
      classList={{ 'drop-active': dropTarget() === '.' }}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDropTarget('.');
      }}
      onDragLeave={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && e.currentTarget.contains(next)) return;
        setDropTarget(null);
      }}
      onDrop={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDropTarget(null);
        void dropUpload(e, '.');
      }}
    >
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <Show when={upload()}>
        {(state) => (
          <div role="status">{t('filetree.uploadingProgress', { done: state().done, total: state().total })}</div>
        )}
      </Show>
      <Show when={preparingDownload()}>
        <div role="status">{downloadProgressText()}</div>
      </Show>
      <div class="filetree-toolbar">
        <button class="icon-btn" onClick={() => showMenu({ path: '.', kind: 'root' })}>＋ {t('filetree.new')}</button>
        <Show when={menu()?.kind === 'root'}>
          <div class="row-menu" onClick={(e) => e.stopPropagation()}>
            <button class="menu-item" onClick={() => beginCreate('file', menu()!)}>{t('filetree.newFile')}</button>
            <UploadItem target={menu()!} />
            <button class="menu-item" onClick={() => beginCreate('dir', menu()!)}>{t('filetree.newDir')}</button>
          </div>
        </Show>
      </div>
      <Show
        when={nodes['.']?.loaded}
        fallback={<div class="view-placeholder">{error() ?? t('loading')}</div>}
      >
        <For each={nodes['.']?.loaded ?? []}>
          {(child) => <TreeNode path={child.name} entry={child} />}
        </For>
      </Show>
      <Show when={dialog()}>
        {(d) => <NameDialog state={d()} onClose={() => { setDialog(null); setMenu(null); }} />}
      </Show>
    </div>
  );
}
