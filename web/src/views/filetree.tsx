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
import { createSignal, For, Show, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api, type DirEntry } from '../api.ts';
import { currentFile, openTab, closeTab, setCurrentFile, pushState, roMode, tabs } from '../stores.ts';
import { parentOf } from '../paths.ts';
import { NameDialog, type DialogState } from '../components/name-dialog.tsx';

type DirState = { expanded: boolean; loaded?: DirEntry[]; loading?: boolean };

// path → 目录状态。渲染时 nodes[path] 是响应式读取，setNodes 精确更新。
const [nodes, setNodes] = createStore<{ [path: string]: DirState }>({});
const [error, setError] = createSignal<string | null>(null);

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

// 只读守卫：写操作一律先查 roMode（服务端仍是最终裁决，403 时 Toast 服务器文案）
function ensureWritable(): boolean {
  if (roMode()) { setError('只读模式：切换编辑模式后再修改文件'); return false; }
  return true;
}

/** 操作完成后刷新父目录列表（保持 loaded 数组与磁盘一致） */
async function refreshParent(parent: string) {
  const { entries } = await api.list(parent);
  setNodes(parent, { loaded: entries });
}

function showMenu(target: MenuTarget) {
  if (!ensureWritable()) return;
  clearTimeout(confirmTimer);
  setConfirmDel(null);
  setMenu(target);
}

// 新建：目录行 → 建在其内；文件行 → 建在其父目录；根 → 根下
function beginCreate(kind: 'file' | 'dir', target: MenuTarget) {
  const base = target.kind === 'dir' ? target.path : parentOf(target.path);
  setDialog({
    title: kind === 'file' ? '新建文件' : '新建目录',
    initial: '',
    submitLabel: '创建',
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
      await api.create(p, roMode());
    } else {
      await api.mkDir(p, roMode()); // 服务端 fs.mkdir；重名 → 409 already exists
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
    title: '重命名',
    initial: target.path.split('/').pop() ?? '',
    submitLabel: '重命名',
    onSubmit: (name) => void doRename(target, name),
  });
}

async function doRename(target: MenuTarget, name: string) {
  setDialog(null); setMenu(null);
  // 子路径统一 childPath(parentOf(target.path), name)：根级 'a.ts' → childPath('.', 'b.ts') = 'b.ts'
  const to = childPath(parentOf(target.path), name);
  if (to === target.path) return; // 同名重命名 = 取消，静默关闭
  try {
    await api.rename(target.path, to, roMode());
    await refreshParent(parentOf(target.path));
    if (tabs().includes(target.path)) {
      // 级联走 stores 的 closeTab/openTab：封装了服务器调用 + 本地信号 + 快照 + pushState，
      // 直接调 api.tabs.close 会漏本地信号更新，旧路径残留标签列表
      await closeTab(target.path);
      await openTab(to);
    } else if (currentFile() === target.path) {
      setCurrentFile(to); pushState();
    }
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
      await api.del(target.path, roMode());
      await refreshParent(parentOf(target.path));
      if (currentFile() === target.path) { setCurrentFile(null); pushState(); }
      if (tabs().includes(target.path)) await closeTab(target.path); // closeTab 含本地移除 + 快照 + pushState
      setError(null);
    } catch (e) { setError((e as Error).message); }
  })();
}

onCleanup(() => clearTimeout(confirmTimer));

function TreeNode(props: { path: string; entry: DirEntry }) {
  // props 对当前实例固定不变；所有可变状态都从 store 响应式读取
  const state = () => nodes[props.path];
  const isDir = props.entry.type === 'dir';
  const isCurrent = () => currentFile() === props.path;
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
    else void openTab(props.path).catch((e) => setError((e as Error).message));
  };

  return (
    <div class="tree-node">
      <div
        class={`tree-row ${isCurrent() ? 'active' : ''}`}
        onClick={onRowClick}
        title={props.path}
      >
        <span class="tree-arrow">{isDir ? (expanded() ? '▾' : '▸') : ''}</span>
        <span class="tree-name">{props.entry.name}</span>
        <div class="tree-row-actions">
          <button
            class="icon-btn row-menu-btn"
            title="操作"
            onClick={(e) => { e.stopPropagation(); showMenu({ path: props.path, kind: isDir ? 'dir' : 'file' }); }}
          >⋯</button>
          <Show when={menu()?.path === props.path}>
            <div class="row-menu" onClick={(e) => e.stopPropagation()}>
              <button class="menu-item" onClick={() => beginCreate('file', menu()!)}>新建文件</button>
              <button class="menu-item" onClick={() => beginCreate('dir', menu()!)}>新建目录</button>
              <Show when={menu()?.kind !== 'root'}>
                <button class="menu-item" onClick={() => beginRename(menu()!)}>重命名</button>
                <button class={`menu-item ${confirmDel() === props.path ? 'danger' : ''}`} onClick={() => onDeleteTap(menu()!)}>
                  {confirmDel() === props.path ? '确认删除？' : '删除'}
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
    </div>
  );
}

export function FileTreeView() {
  void ensureRoot();

  return (
    <div class="filetree">
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <div class="filetree-toolbar">
        <button class="icon-btn" onClick={() => showMenu({ path: '.', kind: 'root' })}>＋ 新建</button>
        <Show when={menu()?.kind === 'root'}>
          <div class="row-menu" onClick={(e) => e.stopPropagation()}>
            <button class="menu-item" onClick={() => beginCreate('file', menu()!)}>新建文件</button>
            <button class="menu-item" onClick={() => beginCreate('dir', menu()!)}>新建目录</button>
          </div>
        </Show>
      </div>
      <Show
        when={nodes['.']?.loaded}
        fallback={<div class="view-placeholder">{error() ?? '加载中…'}</div>}
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
