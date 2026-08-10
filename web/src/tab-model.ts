// web/src/tab-model.ts
// 通用标签模型（spec §5.2）：文件标签 id=path，终端标签 id=terminalId。
// 纯函数，node --test 可测；stores/视图层共用。
export type TabItem =
  | { kind: 'file'; id: string; path: string }
  | { kind: 'terminal'; id: string; name: string }
  | { kind: 'git'; id: 'git' }
  | { kind: 'git-diff'; id: string; path: string }
  | { kind: 'git-history'; id: 'git-history' }
  | { kind: 'git-branch'; id: 'git-branch' }
  | { kind: 'git-commit'; id: string; commit: string };

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

/** 关闭当前标签后的回退：文件优先，否则任意剩余标签，无则 null（spec §9 回文件或空） */
export function nextActiveTabId(tabs: TabItem[], closedId: string): string | null {
  const rest = tabs.filter((t) => t.id !== closedId);
  return rest.find((t) => t.kind === 'file')?.id ?? rest[0]?.id ?? null;
}

export function terminalExists(tabs: TabItem[], id: string): boolean {
  return tabs.some((t) => t.id === id && t.kind === 'terminal');
}

export const GIT_TAB_ID = 'git';

export function gitDiffTabId(path: string): string {
  return `git-diff:${path}`;
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

export const GIT_HISTORY_TAB_ID = 'git-history';
export const GIT_BRANCH_TAB_ID = 'git-branch';

export function gitCommitTabId(hash: string): string {
  return `git-commit:${hash}`;
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
