import { createSignal, createEffect, For, Show } from 'solid-js';
import { views } from './views/registry.tsx';
import { roMode, setRoMode } from './stores.ts';

const NARROW_QUERY = '(max-width: 599px)';

export function useIsNarrow(): () => boolean {
  const [narrow, setNarrow] = createSignal(
    typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );
  if (typeof window !== 'undefined') {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
  }
  return narrow;
}

export function App() {
  const isNarrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [activeView, setActiveView] = createSignal('filetree');

  return (
    <div class={`app ${isNarrow() ? 'narrow' : 'wide'}`}>
      <header class="toolbar">
        <button class="icon-btn" onClick={() => setDrawerOpen(!drawerOpen())} title="菜单">
          ☰
        </button>
        <span class="toolbar-path">{/* Task 13: 当前文件路径 */}</span>
        <button
          class={`icon-btn ${roMode() ? '' : 'active'}`}
          onClick={() => setRoMode(!roMode())}
          title={roMode() ? '切换为编辑模式' : '切换为只读模式'}
        >
          ✎
        </button>
      </header>

      <main class="editor-area">{/* Task 13: CodeMirror */}</main>

      <Show when={drawerOpen()}>
        <div class="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
        <aside class="drawer">
          <nav class="drawer-views">
            <For each={views}>
              {(v) => (
                <button
                  class={activeView() === v.id ? 'view-tab active' : 'view-tab'}
                  onClick={() => setActiveView(v.id)}
                  title={v.title}
                >
                  {v.icon}
                </button>
              )}
            </For>
          </nav>
          <div class="drawer-content">
            <For each={views}>
              {(v) => (
                <Show when={activeView() === v.id}>{v.render()}</Show>
              )}
            </For>
          </div>
        </aside>
      </Show>
    </div>
  );
}
