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
import { createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api, type DirEntry } from '../api.ts';
import { currentFile, openTab } from '../stores.ts';

type DirState = { expanded: boolean; loaded?: DirEntry[]; loading?: boolean };

// path → 目录状态。渲染时 nodes[path] 是响应式读取，setNodes 精确更新。
const [nodes, setNodes] = createStore<{ [path: string]: DirState }>({});
const [error, setError] = createSignal<string | null>(null);

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
      <Show
        when={nodes['.']?.loaded}
        fallback={<div class="view-placeholder">{error() ?? '加载中…'}</div>}
      >
        <For each={nodes['.']?.loaded ?? []}>
          {(child) => <TreeNode path={child.name} entry={child} />}
        </For>
      </Show>
    </div>
  );
}
