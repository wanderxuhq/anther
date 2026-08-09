// web/src/views/tabs.tsx
import { For, Show } from 'solid-js';
import { tabs, currentTabId, switchTab, closeTab, closeTerminal } from '../stores.ts';
import { t } from '../i18n.ts';

export function TabsView() {
  return (
    <div class="tabs-view">
      <Show when={tabs().length === 0} fallback={
        <ul class="tab-list">
          <For each={tabs()}>
            {(tab) => (
              <li class={`tab-row ${currentTabId() === tab.id ? 'active' : ''}`}>
                <span class="tab-icon">{tab.kind === 'file' ? '📄' : '🖥'}</span>
                <span
                  class="tab-name"
                  onClick={() => void switchTab(tab.id)}
                  title={tab.kind === 'file' ? tab.path : tab.id}
                >
                  {tab.kind === 'file' ? tab.path.split('/').pop() : tab.name}
                </span>
                <button
                  class="tab-close"
                  onClick={() => void (tab.kind === 'file' ? closeTab(tab.path) : closeTerminal(tab.id))}
                  title={t('close')}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      }>
        <div class="view-placeholder">{t('tabs.empty')}</div>
      </Show>
    </div>
  );
}
