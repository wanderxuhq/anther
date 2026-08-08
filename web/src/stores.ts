// web/src/stores.ts
import { createSignal } from 'solid-js';
import { parseUrl, serializeUrl, type UrlState } from './url-state.ts';
import { api, loadTabsSnapshot, saveTabsSnapshot } from './api.ts';

export const [currentFile, setCurrentFile] = createSignal<string | null>(null);
export const [roMode, setRoMode] = createSignal(true);
export const [tabs, setTabs] = createSignal<string[]>([]);
export const [theme, setTheme] = createSignal<'auto' | 'light' | 'dark'>('auto');
export const [fontScale, setFontScale] = createSignal(100);

let started = false;

/** 将当前状态写入 URL（replaceState，不污染历史） */
export function pushState(): void {
  const state: UrlState = {
    path: currentFile(),
    ro: roMode(),
    theme: theme(),
    fs: fontScale(),
  };
  const url = serializeUrl(state);
  if (window.location.pathname + window.location.search !== url) {
    window.history.replaceState(null, '', url);
  }
}

/** 页面加载时调用一次：URL → 状态；拉取标签；恢复快照；启动心跳 */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;

  const s = parseUrl(window.location.href);
  setCurrentFile(s.path);
  setRoMode(s.ro);
  setTheme(s.theme);
  setFontScale(s.fs);
  applyTheme(s.theme);

  // 浏览器前进/后退：popstate → 重解析 URL → 覆盖状态（不 pushState，历史由浏览器管理）
  window.addEventListener('popstate', () => {
    const st = parseUrl(window.location.href);
    setCurrentFile(st.path);
    setRoMode(st.ro);
    setTheme(st.theme);
    setFontScale(st.fs);
    applyTheme(st.theme);
  });

  // 标签：拉取服务器列表；服务器为空（重启过）→ 用本地快照 restore
  try {
    const { tabs: serverTabs } = await api.tabs.list();
    if (serverTabs.length === 0) {
      const snapshot = loadTabsSnapshot();
      if (snapshot && snapshot.length > 0) {
        const { restored } = await api.tabs.restore(snapshot);
        if (restored) setTabs(snapshot);
      }
    } else {
      setTabs(serverTabs);
    }
  } catch { /* 服务器不可达：静默，心跳循环会重试 */ }

  // 心跳：每 30s 上报（保活 + 服务器重启后重连）
  setInterval(() => {
    void api.tabs.heartbeat().catch(() => { /* 静默 */ });
  }, 30_000);

  // 标签变化时更新本地快照（供重启恢复）
  // （在 open/close/front 操作处调用 saveTabsSnapshot）
}

// 模块级 flag 防重复注册系统主题变化监听（applyTheme 可能被 popstate/启动多次调用）
let mqlListener: ((e: MediaQueryListEvent) => void) | null = null;

export function applyTheme(t: 'auto' | 'light' | 'dark'): void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const dark = t === 'dark' || (t === 'auto' && mql.matches);
  // CSS 暗色块挂在 :root[data-theme='dark'] 上（不再依赖系统媒体查询），data-theme 是唯一开关
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  if (t === 'auto') {
    if (!mqlListener) {
      mqlListener = () => applyTheme(theme()); // theme 为本模块信号
      mql.addEventListener('change', mqlListener);
    }
  } else if (mqlListener) {
    mql.removeEventListener('change', mqlListener);
    mqlListener = null;
  }
}

// 供 Task 12 使用：打开/关闭/前台操作的统一入口
export async function openTab(path: string): Promise<void> {
  await api.tabs.open(path);
  setCurrentFile(path);
  setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
  await api.tabs.front(path);
  saveTabsSnapshot(tabs());
  pushState();
}

export async function closeTab(path: string): Promise<void> {
  await api.tabs.close(path);
  setTabs((prev) => prev.filter((t) => t !== path));
  if (currentFile() === path) setCurrentFile(null);
  saveTabsSnapshot(tabs());
  pushState();
}
