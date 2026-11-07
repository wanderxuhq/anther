import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { InstancesPage } from './views/instances.tsx';
import { isInstancesPath } from './mount-list.ts';
import { applyTheme, setTheme, startSync } from './stores.ts';
import { parseUrl } from './url-state.ts';
import { initI18n } from './i18n.ts';
import { setBasePath } from './base.ts';
import './styles.css';
import '@fontsource/dejavu-mono/400.css';

// 服务端为挂载路径注入 window.__ANTHER_BASE__；根路径未注入时默认空串。
setBasePath((globalThis as unknown as { __ANTHER_BASE__?: unknown }).__ANTHER_BASE__);

// 渲染前应用界面语言（默认英语，按浏览器语言自动切换；?lang= 可覆盖）。
// 必须早于 render：视图 title 等 JSX 在渲染时读 lang 信号。
initI18n();

const instancesPage = isInstancesPath(window.location.pathname);
if (instancesPage && window.location.pathname === '/-/') {
  // 规范地址是 /-；保留查询/片段。
  window.history.replaceState(null, '', `/-${window.location.search}${window.location.hash}`);
}
if (instancesPage) {
  // 列表页不启动工作区同步，但仍应用 ?theme= / 系统主题。
  const state = parseUrl(window.location.href);
  setTheme(state.theme);
  applyTheme(state.theme);
}

// 键盘/浏览器工具栏遮挡兜底：visualViewport 报告真实可视区高度。部分浏览器
// （如 Vivaldi 移动端）键盘弹出时 dvh 不扣底部地址栏占位，页面底部被盖住；
// Chrome/iOS 的 dvh 行为正确，此时 vv.height 与 dvh 一致，无行为差异。
// CSS 侧 .app 用 height: var(--vvh, 100dvh) 兜底。
function trackVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply); // iOS 键盘弹出只触发 scroll 的变体
  apply();
}
trackVisualViewport();

// 实例列表页不启动工作区同步；普通页面才同步 URL → 状态、标签和心跳。
if (!instancesPage) void startSync();

render(() => instancesPage ? <InstancesPage /> : <App />, document.getElementById('root')!);
