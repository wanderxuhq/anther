// web/src/stores.ts
import { createSignal, createMemo } from 'solid-js';
import { parseUrl, serializeUrl, type UrlState } from './url-state.ts';
import { api, loadTabsSnapshot, saveTabsSnapshot, type TerminalInfo } from './api.ts';
import type { EditorHandle } from './editor/index.ts';
import {
  addFileTab, removeTabById, fileTabPaths, currentFilePath, nextActiveTabId,
  terminalExists, type TabItem,
} from './tab-model.ts';
import { t } from './i18n.ts';

export const [tabs, setTabs] = createSignal<TabItem[]>([]);
export const [currentTabId, setCurrentTabId] = createSignal<string | null>(null);
export const [roMode, setRoMode] = createSignal(true);
export const [theme, setTheme] = createSignal<'auto' | 'light' | 'dark'>('auto');
export const [fontScale, setFontScale] = createSignal(100);

/** 当前前台标签（文件/终端），无则 null */
export const activeTab = createMemo<TabItem | null>(() => {
  const id = currentTabId();
  if (!id) return null;
  return tabs().find((t) => t.id === id) ?? null;
});
/** 当前前台文件路径：当前标签是文件才有值，终端/无标签为 null（spec §5.3 主区域二选一） */
export const currentFile = createMemo<string | null>(() => currentFilePath(tabs(), currentTabId()));

// 搜索跳转管道 / 文档加载路径 / 编辑器句柄（原样保留）
export const [pendingGoto, setPendingGoto] = createSignal<{ path: string; line0: number } | null>(null);
export const [docLoadedPath, setDocLoadedPath] = createSignal<string | null>(null);
export const [editorHandle, setEditorHandle] = createSignal<EditorHandle | null>(null);

let started = false;

// 终端名完全本地生成：计数种子 = startSync 时服务端存活的终端数（服务端内存态、
// 重启清零）。只增不减：进程退出标签移除，但序号不复用，存活终端内编号不重复。
let termCount = 0;

/** 将当前状态写入 URL：当前标签是文件 → path 参数；终端 → term 参数（互斥） */
export function pushState(): void {
  const state: UrlState = { path: null, term: null, ro: roMode(), theme: theme(), fs: fontScale() };
  const t = activeTab();
  if (t?.kind === 'file') state.path = t.path;
  else if (t?.kind === 'terminal') state.term = t.id;
  const url = serializeUrl(state);
  if (window.location.pathname + window.location.search !== url) {
    window.history.replaceState(null, '', url);
  }
}

/** 页面加载时调用一次：URL → 状态；拉文件标签 + 终端标签；恢复快照；启动心跳 */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;

  const s = parseUrl(window.location.href);
  setRoMode(s.ro);
  setTheme(s.theme);
  setFontScale(s.fs);
  applyTheme(s.theme);

  // 浏览器前进/后退：popstate → 重解析 URL → 覆盖状态（term 按当前终端标签校验存在性）
  window.addEventListener('popstate', () => {
    const st = parseUrl(window.location.href);
    setRoMode(st.ro);
    setTheme(st.theme);
    setFontScale(st.fs);
    applyTheme(st.theme);
    if (st.term) {
      setCurrentTabId(terminalExists(tabs(), st.term) ? st.term : null);
    } else {
      setCurrentTabId(st.path);
    }
  });

  // 文件标签（既有逻辑，转为 TabItem）
  let fileTabs: TabItem[] = [];
  try {
    const { tabs: serverTabs } = await api.tabs.list();
    if (serverTabs.length === 0) {
      const snapshot = loadTabsSnapshot();
      if (snapshot && snapshot.length > 0) {
        const { restored } = await api.tabs.restore(snapshot);
        if (restored) fileTabs = snapshot.map((p) => ({ kind: 'file', id: p, path: p }));
      }
    } else {
      fileTabs = serverTabs.map((p) => ({ kind: 'file', id: p, path: p }));
    }
  } catch { /* 服务器不可达：静默，心跳会重试 */ }

  // 终端标签（每用户私有，后台常驻进程都在）
  let termTabs: TabItem[] = [];
  try {
    const { terminals } = await api.terminals.list();
    termTabs = terminals.map((t) => ({ kind: 'terminal', id: t.id, name: t.name }));
    termCount = terminals.length; // 种子：后续新建终端从存活数继续编号
  } catch { /* 静默 */ }
  setTabs([...fileTabs, ...termTabs]);

  // 前台：term 指向的终端还在 → 设为前台；不存在（他人/失效/服务器重启）→ 静默降级（空态）
  if (s.term) {
    if (termTabs.some((t) => t.id === s.term)) setCurrentTabId(s.term);
  } else {
    setCurrentTabId(s.path);
  }

  // 心跳：每 30s 上报（保活 + 服务器重启后重连）
  setInterval(() => {
    void api.tabs.heartbeat().catch(() => { /* 静默 */ });
  }, 30_000);
}

// 模块级 flag 防重复注册系统主题变化监听
let mqlListener: ((e: MediaQueryListEvent) => void) | null = null;

export function applyTheme(t: 'auto' | 'light' | 'dark'): void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const dark = t === 'dark' || (t === 'auto' && mql.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  if (t === 'auto') {
    if (!mqlListener) {
      mqlListener = () => applyTheme(theme());
      mql.addEventListener('change', mqlListener);
    }
  } else if (mqlListener) {
    mql.removeEventListener('change', mqlListener);
    mqlListener = null;
  }
}

/** 打开/前台一个文件标签 */
export async function openTab(path: string): Promise<void> {
  await api.tabs.open(path);
  setTabs((prev) => addFileTab(prev, path));
  setCurrentTabId(path);
  await api.tabs.front(path);
  saveTabsSnapshot(fileTabPaths(tabs()));
  pushState();
}

/** 搜索跳转统一入口（原逻辑，currentFile 已为 memo） */
export function gotoLine0(path: string, line0: number): void {
  const h = editorHandle();
  if (currentFile() === path && docLoadedPath() === path && h) {
    h.gotoLine(line0);
    return;
  }
  setPendingGoto({ path, line0 });
  void openTab(path);
}

export async function closeTab(path: string): Promise<void> {
  await api.tabs.close(path);
  const closedId = path;
  setTabs((prev) => removeTabById(prev, closedId));
  if (currentTabId() === closedId) setCurrentTabId(nextActiveTabId(tabs(), closedId));
  saveTabsSnapshot(fileTabPaths(tabs()));
  pushState();
}

/** 切换到任意标签（侧栏点击）：文件走 openTab（含服务端 front），终端只设前台 */
export async function switchTab(id: string): Promise<void> {
  const t = tabs().find((x) => x.id === id);
  if (!t) return;
  if (t.kind === 'file') {
    await openTab(t.path);
  } else {
    setCurrentTabId(id);
    pushState();
  }
}

/** 新建终端（活动栏 ➕）：本地生成本地化名 → 创建 → 加标签 → 设为前台。失败抛错（调用方 Toast） */
export async function openTerminal(): Promise<TerminalInfo> {
  const name = t('terminal.name', { n: ++termCount });
  const info = await api.terminals.create(name);
  setTabs((prev) => [...prev, { kind: 'terminal', id: info.id, name: info.name }]);
  setCurrentTabId(info.id);
  pushState();
  return info;
}

/** 用户点终端标签 ×：杀进程 + 移除标签 */
export async function closeTerminal(id: string): Promise<void> {
  await api.terminals.close(id).catch(() => { /* 进程可能已退出 */ });
  removeTerminalTab(id);
}

/** 前端移除终端标签（closeTerminal 成功后 / WS exit 帧 / 重连 4404 失效） */
export function removeTerminalTab(id: string): void {
  setTabs((prev) => removeTabById(prev, id));
  if (currentTabId() === id) setCurrentTabId(nextActiveTabId(tabs(), id));
  pushState();
}
