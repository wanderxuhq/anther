// web/src/views/tabs.tsx
import { For, Show } from 'solid-js';
import { tabs, currentTabId, switchTab, closeTab, closeTerminal } from '../stores.ts';

export function TabsView() {
  return (
    <div class="tabs-view">
      <Show when={tabs().length === 0} fallback={
        <ul class="tab-list">
          <For each={tabs()}>
            {(t) => (
              <li class={`tab-row ${currentTabId() === t.id ? 'active' : ''}`}>
                <span class="tab-icon">{t.kind === 'file' ? '📄' : '🖥'}</span>
                <span
                  class="tab-name"
                  onClick={() => void switchTab(t.id)}
                  title={t.kind === 'file' ? t.path : t.id}
                >
                  {t.kind === 'file' ? t.path.split('/').pop() : t.name}
                </span>
                <button
                  class="tab-close"
                  onClick={() => void (t.kind === 'file' ? closeTab(t.path) : closeTerminal(t.id))}
                  title="关闭"
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      }>
        <div class="view-placeholder">暂无标签，从文件树打开文件</div>
      </Show>
    </div>
  );
}
