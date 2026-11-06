// web/src/views/git.test.ts
// GitView 的 DOM 无关纯逻辑：暂存/工作区分组、状态字母、提交可用性。
// 纯函数已抽到 git-model.ts，node:test 可直接导入（.tsx 无法被 Node 直接加载）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitStatus } from '../api.ts';
import {
  allPaths, canCommit, changeBadge, stagedChanges, statusClass, unstagedChanges,
} from './git-model.ts';

const status: GitStatus = {
  isRepo: true,
  branch: 'main',
  hasCommits: true,
  upstream: 'origin/main',
  ahead: 1,
  behind: 0,
  changes: [
    { path: 'a.ts', status: 'M', index: 'M', worktree: ' ', staged: true },
    { path: 'b.ts', status: 'M', index: 'M', worktree: 'M', staged: true },
    { path: 'c.ts', status: '??', index: '?', worktree: '?', staged: false },
    { path: 'd.ts', status: 'D', index: ' ', worktree: 'D', staged: false },
  ],
};

test('stagedChanges / unstagedChanges：按 index/worktree 两列分组', () => {
  assert.deepEqual(stagedChanges(status).map((c) => c.path), ['a.ts', 'b.ts']);
  // b.ts 两侧都有改动 → 两组都出现；c/d 只在工作区组
  assert.deepEqual(unstagedChanges(status).map((c) => c.path), ['b.ts', 'c.ts', 'd.ts']);
  assert.deepEqual(stagedChanges(null), []);
  assert.deepEqual(unstagedChanges(null), []);
});

test('changeBadge：暂存组看 index，工作区组看 worktree，未跟踪显示 ??', () => {
  const byPath = Object.fromEntries(status.changes.map((c) => [c.path, c]));
  assert.equal(changeBadge(byPath['a.ts'], true), 'M');
  assert.equal(changeBadge(byPath['a.ts'], false), ' '); // 工作区已干净
  assert.equal(changeBadge(byPath['b.ts'], true), 'M');
  assert.equal(changeBadge(byPath['b.ts'], false), 'M');
  assert.equal(changeBadge(byPath['c.ts'], false), '??');
  assert.equal(changeBadge(byPath['d.ts'], false), 'D');
});

test('canCommit：需要提交信息 + 至少一个已暂存改动', () => {
  assert.equal(canCommit(status, 'feat: x'), true);
  assert.equal(canCommit(status, '   '), false);
  assert.equal(canCommit({ ...status, changes: status.changes.filter((c) => !c.staged) }, 'feat: x'), false);
  assert.equal(canCommit(null, 'feat: x'), false);
});

test('statusClass：状态字母 → 着色类名', () => {
  assert.equal(statusClass('??'), 'untracked');
  assert.equal(statusClass('?'), 'untracked');
  assert.equal(statusClass('M'), 'modified');
  assert.equal(statusClass('A'), 'added');
  assert.equal(statusClass('D'), 'deleted');
  assert.equal(statusClass('R'), 'renamed');
  assert.equal(statusClass('C'), 'renamed');
});

test('allPaths：当前所有改动路径', () => {
  assert.deepEqual(allPaths(status), ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  assert.deepEqual(allPaths(null), []);
});
