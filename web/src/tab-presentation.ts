import { fileTargetName, fileTargetLabel } from './file-target.ts';
import type { TabItem } from './tab-model.ts';
import { t } from './i18n.ts';
import type { IconName } from './components/icons.tsx';

export function tabIcon(tab: TabItem): IconName {
  if (tab.kind === 'database') return tab.object?.type === 'view' ? 'eye' : 'table';
  if (tab.kind === 'file') return 'file';
  if (tab.kind === 'terminal') return 'terminal';
  if (tab.kind === 'git') return 'git-changes';
  if (tab.kind === 'git-history') return 'git-history';
  if (tab.kind === 'git-branch') return 'git-branch';
  if (tab.kind === 'git-commit') return 'commit';
  return 'diff'; // git-diff
}

export function tabName(tab: TabItem): string {
  if (tab.kind === 'database') return tab.object ? `${tab.object.name} · ${t(`database.${tab.mode}`)}` : fileTargetName(tab).split('/').pop()!;
  if (tab.kind === 'file' || tab.kind === 'git-diff') return tab.path.split('/').pop() ?? tab.path;
  if (tab.kind === 'terminal') return tab.name;
  if (tab.kind === 'git-history') return t('git.history');
  if (tab.kind === 'git-branch') return t('git.branch');
  if (tab.kind === 'git-commit') return tab.commit;
  return t('view.git');
}

export function tabTitle(tab: TabItem): string {
  if (tab.kind === 'database') return `${fileTargetLabel(tab)}${tab.object ? ` › ${tabName(tab)}` : ''}`;
  if (tab.kind === 'file' || tab.kind === 'git-diff') return tab.path;
  if (tab.kind === 'git-history') return t('git.history');
  if (tab.kind === 'git-branch') return t('git.branch');
  if (tab.kind === 'git-commit') return tab.commit;
  return t('view.git');
}
