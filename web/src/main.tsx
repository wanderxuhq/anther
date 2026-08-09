import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { startSync } from './stores.ts';
import { initI18n } from './i18n.ts';
import './styles.css';

// 渲染前定死界面语言（默认英语，按浏览器语言自动切换；?lang= 可覆盖）。
// 必须早于 render：视图 title 等 JSX 在渲染时读 lang 信号。
initI18n();

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

// 加载时同步 URL → 状态、拉取/恢复标签、注册 popstate（前进/后退）监听、启动心跳
void startSync();

render(() => <App />, document.getElementById('root')!);
