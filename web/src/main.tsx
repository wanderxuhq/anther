import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { startSync } from './stores.ts';
import './styles.css';

// 加载时同步 URL → 状态、拉取/恢复标签、注册 popstate（前进/后退）监听、启动心跳
void startSync();

render(() => <App />, document.getElementById('root')!);
