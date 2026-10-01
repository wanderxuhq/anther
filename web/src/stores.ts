// web/src/stores.ts
import { batch, createSignal, createMemo } from 'solid-js';
import { DEFAULT_STATE, DEFAULT_EXCLUDE, parseUrl, serializeUrl, type UrlState, type Panel, type LineRange } from './url-state.ts';
import { api, loadTabsSnapshot, saveTabsSnapshot, type TerminalInfo } from './api.ts';
import type { EditorHandle } from './editor/index.ts';
import {
  addFileTab, removeTabById, fileTabPaths, currentFilePath, nextActiveTabId,
  terminalExists, addGitTab, addGitDiffTab, gitDiffTabId, GIT_TAB_ID, type TabItem,
  addGitHistoryTab, addGitBranchTab, addGitCommitTab, gitCommitTabId,
  GIT_HISTORY_TAB_ID, GIT_BRANCH_TAB_ID,
} from './tab-model.ts';
import { t, applyLanguage } from './i18n.ts';

export const [tabs, setTabs] = createSignal<TabItem[]>([]);
export const [currentTabId, setCurrentTabId] = createSignal<string | null>(null);
export const [roMode, setRoMode] = createSignal(true);
export const [theme, setTheme] = createSignal<'auto' | 'light' | 'dark'>('auto');
export const [fontScale, setFontScale] = createSignal(100);
export const [activePanel, setActivePanel] = createSignal<Panel>('files');
export const [drawerOpen, setDrawerOpen] = createSignal(false);
export const [searchQuery, setSearchQuery] = createSignal('');
export const [searchCaseSensitive, setSearchCaseSensitive] = createSignal(false);
export const [searchExclude, setSearchExclude] = createSignal(DEFAULT_EXCLUDE);
export const [historyBranch, setHistoryBranch] = createSignal<string | null>(null);
const [urlLang, setUrlLang] = createSignal<UrlState['lang']>(null);
const [pendingTerminal, setPendingTerminal] = createSignal<string | null>(null);
const [filePosition, setFilePosition] = createSignal<{ path: string; line: LineRange } | null>(null);
const [archiveLocation, setArchiveLocation] = createSignal<{ path: string; entry: string | null; chain: string[] } | null>(null);
const EMPTY_ARCHIVE_CHAIN: string[] = [];

/** 当前前台标签（文件/终端），无则 null */
export const activeTab = createMemo<TabItem | null>(() => {
  const id = currentTabId();
  if (!id) return null;
  return tabs().find((t) => t.id === id) ?? null;
});
/** 当前前台文件路径：当前标签是文件才有值，终端/无标签为 null（spec §5.3 主区域二选一） */
export const currentFile = createMemo<string | null>(() => currentFilePath(tabs(), currentTabId()));
/** 当前文件标签对应的压缩包内部路径；切换到其他文件或普通打开时清空。 */
export const archiveEntry = createMemo<string | null>(() => {
  const location = archiveLocation();
  return location?.path === currentFile() ? location.entry : null;
});
/** 当前压缩包内的嵌套路径链；路径不匹配时返回稳定空数组。 */
export const archiveChain = createMemo<string[]>(() => {
  const location = archiveLocation();
  return location?.path === currentFile() ? location.chain : EMPTY_ARCHIVE_CHAIN;
});

// 搜索跳转管道 / 文档加载路径 / 编辑器句柄（原样保留）
export const [pendingGoto, setPendingGoto] = createSignal<{ path: string; line0: number; endLine0?: number; reveal?: boolean } | null>(null);
export const [docLoadedPath, setDocLoadedPath] = createSignal<string | null>(null);
export const [editorHandle, setEditorHandle] = createSignal<EditorHandle | null>(null);

// git 元信息：currentBranch 供工具栏分支名显示（非仓库 → null → 显示 '—'）；
// gitRefreshTick 是 git 相关视图的统一刷新信号（checkout/commit/新建分支/工具栏 🔄 后 bump → 视图重拉）
export const [currentBranch, setCurrentBranch] = createSignal<string | null>(null);
export const [gitRefreshTick, setGitRefreshTick] = createSignal(0);

let started = false;
let terminalsLoaded = false;

// 终端名完全本地生成：计数种子 = startSync 时服务端存活的终端数（服务端内存态、
// 重启清零）。只增不减：进程退出标签移除，但序号不复用，存活终端内编号不重复。
let termCount = 0;

/** 主导航新增历史；连续输入/选区变化只替换当前历史。恢复 URL 不调用此函数。 */
export function pushState(mode: 'push' | 'replace' = 'push'): void {
  const state: UrlState = {
    ...DEFAULT_STATE, ro: roMode(), theme: theme(), fs: fontScale(), lang: urlLang(),
    panel: activePanel(), query: searchQuery(), caseSensitive: searchCaseSensitive(), exclude: searchExclude(),
  };
  const tab = activeTab();
  if (tab) setPendingTerminal(null);
  if (tab?.kind === 'file') {
    state.path = tab.path;
    state.entry = archiveEntry();
    state.inside = archiveChain();
    const position = filePosition();
    state.line = position?.path === tab.path ? position.line : null;
  } else if (tab?.kind === 'terminal') state.term = tab.id;
  else if (tab?.kind === 'git') state.view = 'git';
  else if (tab?.kind === 'git-diff') { state.view = 'diff'; state.path = tab.path; }
  else if (tab?.kind === 'git-history') { state.view = 'history'; state.branch = historyBranch(); }
  else if (tab?.kind === 'git-branch') state.view = 'branches';
  else if (tab?.kind === 'git-commit') { state.view = 'commit'; state.commit = tab.commit; }
  else if (!tab) state.term = pendingTerminal();
  const url = serializeUrl(state);
  if (window.location.pathname + window.location.search !== url) {
    if (mode === 'replace') window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  }
}

export function selectPanel(panel: Panel): void {
  batch(() => { setActivePanel(panel); setDrawerOpen(true); });
  pushState();
}

export function updateSearch(patch: Partial<Pick<UrlState, 'query' | 'caseSensitive' | 'exclude'>>): void {
  batch(() => {
    if (patch.query !== undefined) setSearchQuery(patch.query);
    if (patch.caseSensitive !== undefined) setSearchCaseSensitive(patch.caseSensitive);
    if (patch.exclude !== undefined) setSearchExclude(patch.exclude);
  });
  pushState('replace');
}

export function selectHistoryBranch(branch: string | null): void {
  setHistoryBranch(branch);
  pushState();
}

/** 编辑器的用户选区变化，不为每次按键新增历史，也不混入其他文件的行号。 */
export function updateFilePosition(line: LineRange): void {
  const path = currentFile();
  if (!path || docLoadedPath() !== path) return;
  setFilePosition({ path, line });
  pushState('replace');
}

async function registerFile(path: string): Promise<void> {
  await api.tabs.open(path);
  if (currentFile() === path) await api.tabs.front(path);
}

/** 初始加载、直接链接、前进/后退共用；先补齐本地标签再激活，网络响应不改变导航目标。 */
export function restoreUrl(state: UrlState, syncServer = true): void {
  // 解析会丢弃不属于当前视图的参数；同步修正地址，避免刷新后 URL 与页面不一致。
  const url = serializeUrl(state);
  if (window.location.pathname + window.location.search !== url) {
    window.history.replaceState(null, '', url + window.location.hash);
  }
  batch(() => {
    setRoMode(state.ro);
    setTheme(state.theme);
    setFontScale(state.fs);
    setUrlLang(state.lang);
    applyTheme(state.theme);
    applyLanguage(state.lang);
    setActivePanel(state.panel);
    // panel 仅记录选中项；抽屉是否展开由本地交互控制，刷新/后退不自动弹出。
    setSearchQuery(state.query);
    setSearchCaseSensitive(state.caseSensitive);
    setSearchExclude(state.exclude);
    setHistoryBranch(state.branch);
    setArchiveLocation((state.entry !== null || state.inside.length > 0) && state.path
      ? { path: state.path, entry: state.entry, chain: state.inside } : null);
    setFilePosition(state.path && state.line ? { path: state.path, line: state.line } : null);
    setPendingGoto(null);
    setPendingTerminal(!terminalsLoaded ? state.term : null);
    if (state.term) {
      setCurrentTabId(terminalExists(tabs(), state.term) ? state.term : null);
    } else if (state.view === 'git') {
      setTabs(addGitTab); setCurrentTabId(GIT_TAB_ID);
    } else if (state.view === 'history') {
      setTabs(addGitHistoryTab); setCurrentTabId(GIT_HISTORY_TAB_ID);
    } else if (state.view === 'branches') {
      setTabs(addGitBranchTab); setCurrentTabId(GIT_BRANCH_TAB_ID);
    } else if (state.view === 'commit' && state.commit) {
      setTabs((prev) => addGitCommitTab(prev, state.commit!)); setCurrentTabId(gitCommitTabId(state.commit));
    } else if (state.view === 'diff' && state.path) {
      setTabs((prev) => addGitDiffTab(prev, state.path!)); setCurrentTabId(gitDiffTabId(state.path));
    } else if (state.path) {
      setTabs((prev) => addFileTab(prev, state.path!)); setCurrentTabId(state.path);
      if (state.line) setPendingGoto({ path: state.path, line0: state.line.start - 1,
        endLine0: state.line.end > state.line.start ? state.line.end - 1 : undefined });
      else setPendingGoto({ path: state.path, line0: 0, reveal: false });
    } else setCurrentTabId(null);
  });
  if (syncServer && currentFile()) {
    saveTabsSnapshot(fileTabPaths(tabs()));
    void registerFile(currentFile()!).catch(() => { /* readFile 负责展示文件加载失败 */ });
  }
}

/** 页面加载时调用一次：URL → 状态；拉文件标签 + 终端标签；恢复快照；启动心跳 */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;

  const s = parseUrl(window.location.href);
  restoreUrl(s, false);

  // 浏览器前进/后退：popstate → 重解析 URL → 覆盖状态（term 按当前终端标签校验存在性）
  window.addEventListener('popstate', () => {
    restoreUrl(parseUrl(window.location.href));
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
  terminalsLoaded = true;
  // 合并加载期间已经打开的本地标签，不用迟到的列表覆盖当前导航。
  setTabs((local) => [...local, ...[...fileTabs, ...termTabs].filter((tab) => !local.some((x) => x.id === tab.id))]);

  // 前台：term 指向的终端还在 → 设为前台；不存在（他人/失效/服务器重启）→ 静默降级（空态）
  // 列表加载期间也可能发生 popstate；只解析此刻的 URL，不重新激活启动时的旧目标。
  const term = parseUrl(window.location.href).term;
  if (term && terminalExists(tabs(), term)) setCurrentTabId(term);
  setPendingTerminal(null);
  if (currentFile()) void registerFile(currentFile()!).catch(() => {});
  saveTabsSnapshot(fileTabPaths(tabs()));

  void refreshGitMeta(); // 工具栏分支名初始化（非阻塞）

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
export async function openTab(path: string, line: LineRange | null = null, entry: string | null = null, chain: string[] = []): Promise<void> {
  batch(() => {
    if (currentFile() !== path || entry !== null || chain.length > 0) setFilePosition(null);
    setArchiveLocation(entry !== null || chain.length > 0 ? { path, entry, chain: [...chain] } : null);
    setPendingGoto(null);
    setTabs((prev) => addFileTab(prev, path));
    setCurrentTabId(path);
    if (line) {
      setFilePosition({ path, line });
      setPendingGoto({ path, line0: line.start - 1, endLine0: line.end > line.start ? line.end - 1 : undefined });
    }
  });
  saveTabsSnapshot(fileTabPaths(tabs()));
  pushState();
  await registerFile(path);
}

/** 打开/切换压缩包内部文件；通过 openTab 只写入一次导航历史。 */
export async function openArchiveEntry(path: string, entry: string | null, chain: string[] = []): Promise<void> {
  await openTab(path, null, entry, chain);
}

/** 搜索跳转统一入口（原逻辑，currentFile 已为 memo） */
export function gotoLine0(path: string, line0: number): void {
  const line = Math.max(1, line0 + 1);
  void openTab(path, { start: line, end: line }).catch(() => {});
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

/** 打开/复用 git 面板标签（单例，完全对齐 openTerminal 的"有则切过去、无则新建"模式）。
 *  git 无服务端进程，纯前端状态；status 由 GitView 挂载时自行拉取。 */
export function openGit(): void {
  setTabs((prev) => addGitTab(prev));
  setCurrentTabId(GIT_TAB_ID);
  pushState();
}

/** 打开/复用某文件的 git-diff 标签，同文件点第二次复用。 */
export function openGitDiff(path: string): void {
  setTabs((prev) => addGitDiffTab(prev, path));
  setCurrentTabId(gitDiffTabId(path));
  pushState();
}

/** 关闭 git / git-diff 标签：只关视图不杀进程（git 无进程），回退到下一个标签 */
export function closeGitTab(id: string): void {
  setTabs((prev) => removeTabById(prev, id));
  if (currentTabId() === id) setCurrentTabId(nextActiveTabId(tabs(), id));
  pushState();
}

/** 拉分支元信息（启动时一次）：currentBranch 失败/非仓库保持 null。checkout/createBranch 成功后各自直接 set。 */
export async function refreshGitMeta(): Promise<void> {
  try {
    const b = await api.git.branches();
    setCurrentBranch(b.current);
  } catch { /* 服务器不可达/非仓库：保持 null，工具栏显示 '—' */ }
}

/** 打开/复用历史标签（单例），URL 保留历史分支筛选。 */
export function openGitHistory(): void {
  setTabs((prev) => addGitHistoryTab(prev));
  setCurrentTabId(GIT_HISTORY_TAB_ID);
  pushState();
}

/** 打开/复用分支标签（单例） */
export function openGitBranch(): void {
  setTabs((prev) => addGitBranchTab(prev));
  setCurrentTabId(GIT_BRANCH_TAB_ID);
  pushState();
}

/** 打开/复用某提交的 diff 标签，同提交去重。 */
export function openGitCommit(hash: string): void {
  setTabs((prev) => addGitCommitTab(prev, hash));
  setCurrentTabId(gitCommitTabId(hash));
  pushState();
}

/**
 * 新建分支（checkout -b）。成功后当前分支即新分支 → 更新 currentBranch + bump gitRefreshTick
 * （分支视图列表 / 工具栏 ⑂ 名自动刷新）。不涉及工作区改动，无需切换保护（spec §5.4 只保护切换已有分支）。
 * 失败抛错，调用方 Toast / 错误条。
 */
export async function createBranch(name: string): Promise<void> {
  const { current } = await api.git.createBranch(name);
  setCurrentBranch(current);
  setGitRefreshTick((x) => x + 1);
}
