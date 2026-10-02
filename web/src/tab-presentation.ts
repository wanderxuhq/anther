import type { TabItem } from './tab-model.ts';
import { t } from './i18n.ts';

export function tabIcon(tab: TabItem): string {
  if (tab.kind === 'database') return tab.object?.type === 'view' ? '◉' : '▦';
  if (tab.kind === 'file') return '📄';
  if (tab.kind === 'terminal') return '🖥';
  if (tab.kind === 'git') return '🕘';
  if (tab.kind === 'git-history') return '📜';
  if (tab.kind === 'git-branch') return '⑂';
  if (tab.kind === 'git-commit') return '↔';
  return '↔'; // git-diff
}

export function tabName(tab: TabItem): string {
  if (tab.kind === 'database') return tab.object ? `${tab.object.name} · ${t(`database.${tab.mode}`)}` : tab.path.split('/').pop()!;
  if (tab.kind === 'file' || tab.kind === 'git-diff') return tab.path.split('/').pop() ?? tab.path;
  if (tab.kind === 'terminal') return tab.name;
  if (tab.kind === 'git-history') return t('git.history');
  if (tab.kind === 'git-branch') return t('git.branch');
  if (tab.kind === 'git-commit') return tab.commit;
  return t('view.git');
}

export function tabTitle(tab: TabItem): string {
  if (tab.kind === 'database') return `${tab.path}${tab.object ? ` › ${tabName(tab)}` : ''}`;
  if (tab.kind === 'file' || tab.kind === 'git-diff') return tab.path;
  if (tab.kind === 'git-history') return t('git.history');
  if (tab.kind === 'git-branch') return t('git.branch');
  if (tab.kind === 'git-commit') return tab.commit;
  return t('view.git');
}
