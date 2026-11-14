// web/src/tab-model.ts
// Content-specific identities are created here; tab presentation and lifecycle use only ids.
// 纯函数，node --test 可测；stores/视图层共用。
import { fileTargetKey, type ArchiveLocation } from './file-target.ts';
import type { DatabaseObject, DatabaseSort, DatabaseRowsRequest } from './database/types.ts';
import type { TablePosition } from './preview-state.ts';
import type { FeaturePanel, FeatureTabSpec } from './feature-types.ts';
export type DatabaseTarget = { archive?: ArchiveLocation; object: DatabaseObject | null; mode: 'data' | 'structure'; sort?: DatabaseSort;
  filter?: DatabaseRowsRequest['filter']; offset?: number; cursor?: string; table?: TablePosition };
export type DatabaseTab = DatabaseTarget & { kind: 'database'; id: string; path: string };
export type FeatureTab = {
  kind: 'feature';
  /** Panel route + subpath; each feature-owned document is its own tab. */
  id: string;
  featureID: string;
  panelID: string;
  route: string;
  title: string;
  icon: string;
  path: string;
};
export type TabItem =
  | DatabaseTab
  | { kind: 'file'; id: string; path: string }
  | { kind: 'terminal'; id: string; name: string }
  | { kind: 'git'; id: '/_/git' }
  | { kind: 'git-diff'; id: string; path: string }
  | { kind: 'git-history'; id: '/_/git/history' }
  | { kind: 'git-branch'; id: '/_/git/branches' }
  | { kind: 'git-commit'; id: string; commit: string }
  | FeatureTab;

export function addFileTab(tabs: TabItem[], path: string): TabItem[] {
  if (tabs.some((t) => t.kind === 'file' && t.path === path)) return tabs;
  return [...tabs, { kind: 'file', id: path, path }];
}

export function removeTabById(tabs: TabItem[], id: string): TabItem[] {
  return tabs.filter((t) => t.id !== id);
}

export function fileTabPaths(tabs: TabItem[]): string[] {
  return tabs.filter((t): t is Extract<TabItem, { kind: 'file' }> => t.kind === 'file')
    .map((t) => t.path);
}

export function currentFilePath(tabs: TabItem[], currentId: string | null): string | null {
  const t = tabs.find((x) => x.id === currentId);
  return t?.kind === 'file' ? t.path : null;
}

/** 关闭当前标签后的回退：文件优先，否则任意剩余标签，无则 null（回文件或空） */
export function nextActiveTabId(tabs: TabItem[], closedId: string): string | null {
  const rest = tabs.filter((t) => t.id !== closedId);
  return rest.find((t) => t.kind === 'file')?.id ?? rest[0]?.id ?? null;
}

export function terminalExists(tabs: TabItem[], id: string): boolean {
  return tabs.some((t) => t.id === id && t.kind === 'terminal');
}

// 文件 id 是相对路径；Git id 用前导 / 隔离，避免与名为 git 等的文件冲突。
export const GIT_TAB_ID = '/_/git';

export function gitDiffTabId(path: string): string {
  return `/_/git/diff/${path}`;
}

export function addGitTab(tabs: TabItem[]): TabItem[] {
  if (tabs.some((t) => t.kind === 'git')) return tabs;
  return [...tabs, { kind: 'git', id: GIT_TAB_ID }];
}

export function addGitDiffTab(tabs: TabItem[], path: string): TabItem[] {
  const id = gitDiffTabId(path);
  if (tabs.some((t) => t.id === id)) return tabs;
  return [...tabs, { kind: 'git-diff', id, path }];
}

export const GIT_HISTORY_TAB_ID = '/_/git/history';
export const GIT_BRANCH_TAB_ID = '/_/git/branches';

export function gitCommitTabId(hash: string): string {
  return `/_/git/commit/${hash}`;
}

export function addGitHistoryTab(tabs: TabItem[]): TabItem[] {
  if (tabs.some((t) => t.kind === 'git-history')) return tabs;
  return [...tabs, { kind: 'git-history', id: GIT_HISTORY_TAB_ID }];
}

export function addGitBranchTab(tabs: TabItem[]): TabItem[] {
  if (tabs.some((t) => t.kind === 'git-branch')) return tabs;
  return [...tabs, { kind: 'git-branch', id: GIT_BRANCH_TAB_ID }];
}

export function addGitCommitTab(tabs: TabItem[], hash: string): TabItem[] {
  const id = gitCommitTabId(hash);
  if (tabs.some((t) => t.id === id)) return tabs;
  return [...tabs, { kind: 'git-commit', id, commit: hash }];
}

/** Stable tab id for a feature route plus subpath. */
export function featureTabId(panel: { route: string }, path = ''): string {
  return `${panel.route}${path || ''}`;
}

/** Open a feature document tab; same panel + subpath reuses one tab. */
export function addFeatureTab(
  tabs: TabItem[],
  panel: { featureID: string; panelID: string; route: string; title: string; icon: string },
  path = '',
): TabItem[] {
  const id = featureTabId(panel, path);
  const existing = tabs.find((tab): tab is FeatureTab => tab.kind === 'feature' && tab.id === id);
  if (existing) {
    if (existing.path === path && existing.title === panel.title && existing.icon === panel.icon) return tabs;
    return tabs.map((tab) => tab.kind === 'feature' && tab.id === id
      ? { ...tab, path, title: panel.title, icon: panel.icon }
      : tab);
  }
  return [...tabs, {
    kind: 'feature',
    id,
    featureID: panel.featureID,
    panelID: panel.panelID,
    route: panel.route,
    title: panel.title,
    icon: panel.icon,
    path,
  }];
}

/**
 * Replace one panel's feature tabs with the documents it currently owns.
 * Non-feature tabs and other panels keep their relative order; the panel's
 * tabs stay grouped where the first one was.
 */
export function syncFeatureTabs(
  tabs: TabItem[],
  panel: FeaturePanel,
  specs: readonly FeatureTabSpec[],
  activeKey?: string | null,
): { tabs: TabItem[]; activeId: string | null } {
  const panelTabs: FeatureTab[] = specs.map((spec) => ({
    kind: 'feature',
    id: featureTabId(panel, spec.path),
    featureID: panel.featureID,
    panelID: panel.panelID,
    route: panel.route,
    title: spec.title || panel.title,
    icon: spec.icon || panel.icon,
    path: spec.path,
  }));
  const first = tabs.findIndex((tab) => tab.kind === 'feature' && tab.panelID === panel.panelID);
  const rest = tabs.filter((tab) => !(tab.kind === 'feature' && tab.panelID === panel.panelID));
  const at = first < 0 ? rest.length : Math.min(first, rest.length);
  const next = [...rest.slice(0, at), ...panelTabs, ...rest.slice(at)];
  const active = specs.find((spec) => spec.key === activeKey);
  return {
    tabs: next,
    activeId: active ? featureTabId(panel, active.path) : panelTabs[0]?.id ?? null,
  };
}

/** Content identity is independent of a backing file. Sort/page are view state, not identity. */
export function databaseTabId(path: string, target: DatabaseTarget): string {
  return '/_/database/' + encodeURIComponent(JSON.stringify([fileTargetKey({ path, archive: target.archive }), target.object?.type ?? null, target.object?.name ?? null, target.mode]));
}
export function addDatabaseTab(tabs: TabItem[], path: string, target: DatabaseTarget): TabItem[] {
  const id = databaseTabId(path, target);
  const existing = tabs.find((tab) => tab.id === id);
  if (existing) return tabs.map((tab) => tab.id === id ? { ...tab, ...target } as DatabaseTab : tab);
  return [...tabs, { kind: 'database', id, path, ...target }];
}
