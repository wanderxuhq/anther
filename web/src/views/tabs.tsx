// web/src/views/tabs.tsx
import { For, Show } from 'solid-js';
import { tabs, currentTabId, switchTab, closeTab, closeTerminal, closeGitTab } from '../stores.ts';
import type { TabItem } from '../tab-model.ts';
import { t } from '../i18n.ts';

function tabIcon(tab: TabItem): string {
  if (tab.kind === 'file') return '📄';
  if (tab.kind === 'terminal') return '🖥';
  if (tab.kind === 'git') return '🕘';
  if (tab.kind === 'git-history') return '📜';
  if (tab.kind === 'git-branch') return '⑂';
  if (tab.kind === 'git-commit') return '↔';
  return '↔'; // git-diff
}

function tabName(tab: TabItem): string {
  if (tab.kind === 'file' || tab.kind === 'git-diff') return tab.path.split('/').pop() ?? tab.path;
  if (tab.kind === 'terminal') return tab.name;
  if (tab.kind === 'git-history') return t('git.history');
  if (tab.kind === 'git-branch') return t('git.branch');
  if (tab.kind === 'git-commit') return tab.commit;
  return t('view.git');
}

function tabTitle(tab: TabItem): string {
  if (tab.kind === 'file' || tab.kind === 'git-diff') return tab.path;
  if (tab.kind === 'git-history') return t('git.history');
  if (tab.kind === 'git-branch') return t('git.branch');
  if (tab.kind === 'git-commit') return tab.commit;
  return t('view.git');
}

function closeTabById(tab: TabItem): void {
  if (tab.kind === 'file') void closeTab(tab.path);
  else if (tab.kind === 'terminal') void closeTerminal(tab.id);
  else void closeGitTab(tab.id); // git / git-diff：只关视图不杀进程
}

export function TabsView() {
  return (
    <div class="tabs-view">
      <Show when={tabs().length === 0} fallback={
        <ul class="tab-list">
          <For each={tabs()}>
            {(tab) => (
              <li class={`tab-row ${currentTabId() === tab.id ? 'active' : ''}`}>
                <span class="tab-icon">{tabIcon(tab)}</span>
                <span class="tab-name" onClick={() => void switchTab(tab.id)} title={tabTitle(tab)}>
                  {tabName(tab)}
                </span>
                <button class="tab-close" onClick={() => closeTabById(tab)} title={t('close')}>
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
