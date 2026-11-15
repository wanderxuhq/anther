// web/src/views/filetree.tsx
// 文件树视图：懒加载目录（点击展开/收起）、文件点击打开、当前文件高亮。
//
// 响应式方案（不使用「可变 Node + setRoot({...root()!}) 强制刷新」）：
// Solid 不追踪对普通对象属性的直接修改，且 For 对相同数组引用不做 diff、
// TreeNode 的 props 非响应式，顶层信号变化不会让已挂载子树重渲染。
// 因此把目录状态放进 createStore（solid-js/store，solid-js 自带，零新增依赖），
// 按 path 存取：
//   nodes[path] → { expanded, loaded?, loading? }   （'.' 为根目录键）
// 渲染时在组件作用域内直接读 nodes[path]（响应式），更新时 setNodes 精确命中该 path，
// 每次展开/收起只触发对应子树重渲染。
import { withFileMutation } from '../file-operations.ts';
import { createEffect, createSignal, ErrorBoundary, For, lazy, Show, Suspense, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api, type DirEntry } from '../api.ts';
import { archiveChain, archiveEntry, activeArchiveRoot, currentFile, activeTab, openDatabaseTab, relocateFileTabs, openTab, tabs, setActivePanel, setDrawerOpen, pushState } from '../stores.ts';
import { tabFilePath } from '../tab-model.ts';
import { parentOf, pathSegments } from '../paths.ts';
import { NameDialog, type DialogState } from '../components/name-dialog.tsx';
import { t } from '../i18n.ts';
import { preparingDownload, downloadProgressText, startDownload } from '../download.ts';
import { isArchiveFile } from '../archive.ts';
import { hasDocumentOutline } from '../readers/document-file.ts';
import { entriesFromDataTransfer, entriesFromFiles, uploadEntries, type UploadEntry } from '../upload.ts';
const DocumentTree = lazy(() => import('../components/document-tree.tsx'));

import { isDatabaseFile } from '../database/source.ts';
import { directoryFailedPatch, directoryLoadedPatch, type DirectoryLoadMode, type DirectoryState } from './filetree-directory.ts';
import { treeWriteSuccess, uploadWriteResult, type TreeWriteResult } from './filetree-write.ts';
import { createDeleteConfirm } from './filetree-delete.ts';
import { browserScheduler, createTransientValue } from '../transient-state.ts';
import { DatabaseIcon } from '../components/database-icon.tsx';
import { Icon } from '../components/icons.tsx';
const DatabaseTree = lazy(() => import('../components/database-tree.tsx'));

const ArchiveTree = lazy(() => import('../components/archive-tree.tsx'));

type DirState = DirectoryState<DirEntry>;

// path → 目录状态。渲染时 nodes[path] 是响应式读取，setNodes 精确更新。
const [nodes, setNodes] = createStore<{ [path: string]: DirState }>({});
const [error, setError] = createSignal<string | null>(null);
const [upload, setUpload] = createSignal<{ done: number; total: number } | null>(null);
const uploading = () => upload() !== null;
/** 拖拽文件悬停的目标路径（'.' 为根），用于高亮可放置位置。 */
const [dropTarget, setDropTarget] = createSignal<string | null>(null);
/** 点击「定位当前文件」后短暂高亮的路径（Scroll from Source）。 */
const [revealPath, setRevealPath] = createSignal<string | null>(null);
const REVEAL_HIGHLIGHT_MS = 1500;
const revealHighlight = createTransientValue<string>((path) => setRevealPath(path), browserScheduler, REVEAL_HIGHLIGHT_MS);

// ---- 文件管理：菜单 + 命名对话框 + 两击确认删除 ----
type MenuTarget = { path: string; kind: 'dir' | 'file' | 'root' };
const [menu, setMenu] = createSignal<MenuTarget | null>(null);
const [dialog, setDialog] = createSignal<DialogState | null>(null);
const [confirmDel, setConfirmDel] = createSignal<string | null>(null); // 两击确认删除
const confirmDelete = createDeleteConfirm((path) => setConfirmDel(path), browserScheduler);

/** 根目录子项不带 './' 前缀：与 URL/currentFile 中的相对路径形式一致，保证高亮可匹配 */
function childPath(parent: string, name: string): string {
  return parent === '.' ? name : `${parent}/${name}`;
}

const directoryLoads = new Map<string, Promise<DirEntry[]>>();

/** Load once (or refresh after a mutation), sharing in-flight requests and state updates. */
async function loadDirectory(path: string, options: { refresh?: boolean; surfaceError?: boolean } = {}): Promise<DirEntry[]> {
  const mode: DirectoryLoadMode = options.refresh ? 'refresh' : 'load';
  if (mode === 'load') {
    const pending = directoryLoads.get(path);
    if (pending) return pending;
    const cached = nodes[path]?.loaded;
    if (cached) return cached;
  } else {
    // A mutation refresh must see the post-mutation result; let any older
    // in-flight list finish first, then replace it with a fresh request.
    const pending = directoryLoads.get(path);
    if (pending) await pending.catch(() => {});
  }
  if (mode === 'load') setNodes(path, { loading: true });
  const task = api.list(path).then(({ entries }) => {
    setNodes(path, directoryLoadedPatch(mode, entries));
    setError(null);
    return entries;
  }, (e) => {
    const patch = directoryFailedPatch<DirEntry>(mode);
    if (Object.keys(patch).length > 0) setNodes(path, patch);
    if (options.surfaceError !== false) setError((e as Error).message);
    throw e;
  }).finally(() => {
    if (directoryLoads.get(path) === task) directoryLoads.delete(path);
  });
  directoryLoads.set(path, task);
  return task;
}

async function expandDirectory(path: string): Promise<void> {
  if (nodes[path]?.expanded) return;
  if (nodes[path]?.loaded) { setNodes(path, 'expanded', true); return; }
  await loadDirectory(path);
}

/** 逐级加载并展开目录；已加载的目录只展开、不重拉。 */
async function expandSegments(parts: string[]): Promise<void> {
  await ensureRoot();
  let parent = '.';
  for (const part of parts) {
    const child = childPath(parent, part);
    await expandDirectory(child);
    parent = child;
  }
}

/** 终端里点开目录：切到文件面板并逐级展开到该目录。 */
export async function revealDirectory(path: string): Promise<void> {
  setActivePanel('files');
  setDrawerOpen(true);
  pushState();
  await expandSegments(pathSegments(path));
}

/** 当前标签页对应的磁盘文件（文件 / 数据库 / 差异标签）；终端等无路径标签返回 null。 */
function activeTabPath(): string | null {
  return tabFilePath(activeTab());
}

function flashReveal(path: string): void {
  revealHighlight.show(path);
}

/** 文件树定位（参考 JetBrains Scroll from Source）：展开祖先目录并滚动高亮当前文件。 */
async function revealCurrentFile(): Promise<void> {
  const path = activeTabPath();
  if (!path) return;
  setActivePanel('files');
  setDrawerOpen(true);
  pushState();
  closeMenu();
  try {
    // 只展开祖先目录；文件本身由 TreeNode 渲染。
    await expandSegments(pathSegments(path, false));
    setError(null);
    flashReveal(path);
  } catch (e) {
    setError((e as Error).message);
  }
}

async function ensureRoot(): Promise<void> {
  try {
    await loadDirectory('.');
  } catch {
    // loadDirectory already publishes the error.
  }
}

// 只读仅控制编辑器内容：文件树写操作不校验 roMode，随时可用
/** Refresh the parent without publishing to the banner; runTreeWrite owns that decision. */
async function refreshParent(parent: string): Promise<string | null> {
  try {
    await loadDirectory(parent, { refresh: true, surfaceError: false });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function closeMenu(): void {
  setMenu(null);
}

function showMenu(target: MenuTarget) {
  confirmDelete.reset();
  setMenu(target);
}

/** 点击菜单外任意位置关闭（菜单项和触发按钮本身除外）。 */
function onDocumentPointerDown(e: PointerEvent): void {
  if (!menu()) return;
  const target = e.target;
  if (target instanceof Element && (target.closest('.row-menu') || target.closest('.menu-trigger'))) return;
  closeMenu();
}

// 新建：目录行 → 建在其内；文件行 → 建在其父目录；根 → 根下
function beginCreate(kind: 'file' | 'dir', target: MenuTarget) {
  closeMenu();
  const base = target.kind === 'dir' ? target.path : parentOf(target.path);
  setDialog({
    title: kind === 'file' ? t('filetree.newFile') : t('filetree.newDir'),
    initial: '',
    submitLabel: t('filetree.create'),
    onSubmit: (name) => void doCreate(kind, base, name),
  });
}

type TreeWriteOptions<T> = {
  /** Serialize through withFileMutation and freeze the editor while saves drain. */
  guard?: boolean;
  refreshOnError?: boolean;
  after?: (result: T) => void | Promise<void>;
};

/** One write pipeline: optional mutation guard, parent refresh, then the typed result's error. */
async function runTreeWrite<T extends TreeWriteResult>(
  path: string,
  parent: string,
  action: () => Promise<T>,
  options: TreeWriteOptions<T> = {},
): Promise<T | undefined> {
  try {
    let result: T;
    if (options.guard === false) result = await action();
    else {
      let value!: T;
      await withFileMutation(path, async () => { value = await action(); });
      result = value;
    }
    const refreshError = await refreshParent(parent);
    await options.after?.(result);
    setError(result.error ?? refreshError ?? null);
    return result;
  } catch (e) {
    setError((e as Error).message);
    // Keep the primary error; refresh is best effort on failure.
    if (options.refreshOnError) await refreshParent(parent);
    return undefined;
  }
}

async function doCreate(kind: 'file' | 'dir', base: string, name: string) {
  setDialog(null); closeMenu();
  const p = childPath(base, name); // 根级不带头 './'（childPath 约定），保证与 URL/currentFile 匹配
  await runTreeWrite(p, base, async () => {
    if (kind === 'file') {
      // 独占创建（POST /api/create，服务端 O_EXCL）：重名 → 409 already exists（服务器文案），
      // 不清空既有文件；不设客户端守卫，服务器是重名裁决的唯一事实源
      await api.create(p);
    } else {
      await api.mkDir(p); // 服务端 fs.mkdir；重名 → 409 already exists
    }
    return treeWriteSuccess();
  }, {
    guard: false,
    after: kind === 'file' ? async () => { await openTab(p); } : undefined,
  });
}

function beginRename(target: MenuTarget) {
  closeMenu();
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
    await runTreeWrite(base, base, async () =>
    uploadWriteResult(await uploadEntries(base, entries, (done, total) => setUpload({ done, total }))), {
      guard: false,
      refreshOnError: true,
      after: () => setNodes(base, 'expanded', true),
    });
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
    // 先算目标目录：closeMenu() 后 props.target 的 getter 重回 menu()，会读到 null。
    const target = base();
    // 先快照 FileList：部分浏览器在 value='' 后会把 input.files 清空。
    const entries = input.files ? entriesFromFiles(input.files) : [];
    input.value = ''; // 允许连续选择同一批文件
    closeMenu();
    if (entries.length > 0) void startUpload(target, entries);
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
  setDialog(null); closeMenu();
  // 子路径统一 childPath(parentOf(target.path), name)：根级 'a.ts' → childPath('.', 'b.ts') = 'b.ts'
  const to = childPath(parentOf(target.path), name);
  if (to === target.path) return; // 同名重命名 = 取消，静默关闭
  await runTreeWrite(target.path, parentOf(target.path), async () => {
    await api.rename(target.path, to);
    await relocateFileTabs(target.path, to);
    return treeWriteSuccess();
  });
}

function onDeleteTap(target: MenuTarget) {
  // 第一击：按钮变「确认删除？」（红），3s 内第二击生效。
  if (confirmDelete.tap(target.path) === 'armed') return;
  closeMenu();
  void runTreeWrite(target.path, parentOf(target.path), async () => {
    await api.del(target.path);
    await relocateFileTabs(target.path);
    return treeWriteSuccess();
  });
}

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
  let rowEl: HTMLDivElement | undefined;
  // 定位后滚动到当前文件；只由匹配的 TreeNode effect 执行。
  createEffect(() => {
    if (revealPath() === props.path && rowEl) rowEl.scrollIntoView({ block: 'nearest' });
  });

  const onToggle = () => {
    if (state()?.expanded) {
      setNodes(props.path, 'expanded', false); // 收起（不丢弃已加载子列表，再展开时零请求）
      return;
    }
    if (state()?.loading) return; // 防连点并发加载
    void expandDirectory(props.path).catch(() => { /* loadDirectory publishes the error */ });
  };

  const onRowClick = () => {
    closeMenu(); // 点击行任意位置关闭操作菜单（点 ⋯ 按钮会 stopPropagation，不走到这里）
    if (isDir) void onToggle();
    // 文件与 link 条目同待遇：点击走 openTab（服务器对损坏链接会 400）
    else if (database()) { setDatabaseExpanded(true); openDatabaseTab(props.path); }
    else void openTab(props.path).catch((e) => setError((e as Error).message));
  };

  return (
    <div class="tree-node">
      <div
        class={`tree-row ${isCurrent() ? 'active' : ''}`}
        classList={{ 'drop-target': dropTarget() === props.path, 'reveal-target': revealPath() === props.path }}
        ref={(el) => (rowEl = el)}
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
        <span class="tree-arrow"><Show when={archive || database() || document} fallback={isDir ? <Icon name={expanded() ? 'chevron-down' : 'chevron-right'} size={14} /> : ''}>
          <button class="archive-toggle" title={t(database() ? 'database.expand' : document ? 'reader.expandOutline' : 'archive.expand')} aria-label={t(database() ? 'database.expand' : document ? 'reader.expandOutline' : 'archive.expand')} aria-expanded={database() ? databaseExpanded() : document ? documentExpanded() : archiveExpanded()} onClick={(e) => { e.stopPropagation(); if (database()) setDatabaseExpanded((value) => !value); else if (document) setDocumentExpanded((value) => !value); else setArchiveExpanded((value) => !value); }}><Icon name={(database() ? databaseExpanded() : document ? documentExpanded() : archiveExpanded()) ? 'chevron-down' : 'chevron-right'} size={14} /></button>
        </Show></span>
        <Show when={archive}><Icon name="archive" size={16} class="archive-icon" /></Show>
        <Show when={database()}><DatabaseIcon/></Show>
        <span class="tree-name">{props.entry.name}</span>
        <div class="tree-row-actions">
          <button
            class="icon-btn row-menu-btn menu-trigger"
            title={t('filetree.actions')}
            onClick={(e) => { e.stopPropagation(); showMenu({ path: props.path, kind: isDir ? 'dir' : 'file' }); }}
          ><Icon name="more" size={18} /></button>
          <Show when={menu()?.path === props.path}>
            <div class="row-menu" onClick={(e) => e.stopPropagation()}>
              <button class="menu-item" onClick={() => beginCreate('file', menu()!)}>{t('filetree.newFile')}</button>
              <UploadItem target={menu()!} />
              <button class="menu-item" onClick={() => beginCreate('dir', menu()!)}>{t('filetree.newDir')}</button>
              <button class="menu-item" disabled={preparingDownload()} onClick={() => {
                closeMenu();
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
        <div
          class="tree-children"
          classList={{ 'drop-target': dropTarget() === props.path }}
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
            if (next instanceof Node && e.currentTarget.contains(next)) return;
            if (dropTarget() === props.path) setDropTarget(null);
          }}
          onDrop={(e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(null);
            void dropUpload(e, props.path);
          }}
        >
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
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true));
  onCleanup(() => revealHighlight.clear());
  onCleanup(() => confirmDelete.reset());

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
        <button
          class="icon-btn menu-trigger"
          title={t('filetree.new')}
          aria-label={t('filetree.new')}
          onClick={() => showMenu({ path: '.', kind: 'root' })}
        ><Icon name="plus" size={16} /></button>
        <button
          class="icon-btn"
          disabled={!activeTabPath()}
          title={t('filetree.reveal')}
          aria-label={t('filetree.reveal')}
          onClick={() => void revealCurrentFile()}
        ><Icon name="locate" size={16} /></button>
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
        {(d) => <NameDialog state={d()} onClose={() => { setDialog(null); closeMenu(); }} />}
      </Show>
    </div>
  );
}
