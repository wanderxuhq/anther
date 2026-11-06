// web/src/views/git-model.ts
// GitView 的纯逻辑：暂存/工作区分组、行内状态字母、提交可用性。
// 不依赖 DOM/JSX，便于 node:test 直接导入。
import type { GitChange, GitStatus } from '../api.ts';

/** 暂存区有内容的改动（index 列非空格且非未跟踪）。 */
export function isStaged(change: GitChange): boolean {
  return change.staged;
}

export function stagedChanges(status: GitStatus | null): GitChange[] {
  return status?.changes.filter(isStaged) ?? [];
}

/** 工作区还有未暂存修改的改动（含未跟踪文件）。 */
export function unstagedChanges(status: GitStatus | null): GitChange[] {
  return status?.changes.filter((change) => change.worktree !== ' ') ?? [];
}

/** 行内状态字母：暂存组显示 index 列，工作区组显示 worktree 列；未跟踪统一显示 ??。 */
export function changeBadge(change: GitChange, staged: boolean): string {
  const char = staged ? change.index : change.worktree;
  return char === '?' ? '??' : char;
}

/** 状态字母 → CSS 着色类名（git-status-<class>） */
export function statusClass(status: string): string {
  if (status === '??' || status === '?') return 'untracked';
  if (status === 'D') return 'deleted';
  if (status === 'A') return 'added';
  if (status === 'R' || status === 'C') return 'renamed';
  return 'modified';
}

export function allPaths(status: GitStatus | null): string[] {
  return status?.changes.map((change) => change.path) ?? [];
}

/** 提交按钮可用性：有提交信息且有已暂存改动。 */
export function canCommit(status: GitStatus | null, message: string): boolean {
  return message.trim() !== '' && stagedChanges(status).length > 0;
}
