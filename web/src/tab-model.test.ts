// web/src/tab-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addFileTab, removeTabById, fileTabPaths, currentFilePath, nextActiveTabId, terminalExists,
  GIT_TAB_ID, gitDiffTabId, addGitTab, addGitDiffTab,
  GIT_HISTORY_TAB_ID, GIT_BRANCH_TAB_ID, gitCommitTabId, addGitHistoryTab, addGitBranchTab, addGitCommitTab,
} from './tab-model.ts';
import type { TabItem } from './tab-model.ts';

const fileA: TabItem = { kind: 'file', id: 'a.ts', path: 'a.ts' };
const fileB: TabItem = { kind: 'file', id: 'b.ts', path: 'b.ts' };
const term1: TabItem = { kind: 'terminal', id: 't_1', name: '终端 1' };
const term2: TabItem = { kind: 'terminal', id: 't_2', name: '终端 2' };

test('addFileTab：已存在不重复，新文件尾插', () => {
  assert.deepEqual(addFileTab([fileA, term1], 'a.ts'), [fileA, term1]);
  assert.deepEqual(addFileTab([fileA], 'b.ts'), [fileA, fileB]);
});

test('removeTabById：按 id 移除任意 kind', () => {
  assert.deepEqual(removeTabById([fileA, term1, fileB], 't_1'), [fileA, fileB]);
});

test('fileTabPaths：只取文件标签路径（供快照）', () => {
  assert.deepEqual(fileTabPaths([fileA, term1, fileB]), ['a.ts', 'b.ts']);
});

test('currentFilePath：文件→path，终端/无→null', () => {
  assert.equal(currentFilePath([fileA, term1], fileA.id), 'a.ts');
  assert.equal(currentFilePath([fileA, term1], term1.id), null);
  assert.equal(currentFilePath([fileA, term1], null), null);
});

test('nextActiveTabId：关当前后回退（文件优先，否则任意剩余，无则 null）', () => {
  assert.equal(nextActiveTabId([fileA, term1], term1.id), fileA.id); // 关终端→回文件
  assert.equal(nextActiveTabId([term1, term2], term1.id), term2.id); // 无文件→回另一终端
  assert.equal(nextActiveTabId([fileA], fileA.id), null);            // 关唯一标签→空
});

test('terminalExists：按 id 判断终端标签', () => {
  assert.equal(terminalExists([fileA, term1], 't_1'), true);
  assert.equal(terminalExists([fileA, term1], 't_9'), false);
});

const gitTab: TabItem = { kind: 'git', id: GIT_TAB_ID };
const diffA: TabItem = { kind: 'git-diff', id: gitDiffTabId('a.ts'), path: 'a.ts' };

test('addGitTab：单例不重复', () => {
  assert.deepEqual(addGitTab([fileA, gitTab]), [fileA, gitTab]);
  const withGit = addGitTab([fileA]);
  assert.equal(withGit.length, 2);
  assert.equal(withGit[1].kind, 'git');
  assert.equal(withGit[1].id, GIT_TAB_ID);
});

test('gitDiffTabId：同文件复用', () => {
  assert.deepEqual(addGitDiffTab([fileA], 'a.ts'), [fileA, diffA]);
  assert.deepEqual(addGitDiffTab([fileA, diffA], 'a.ts'), [fileA, diffA]); // 已存在 → 原样
});

const historyTab: TabItem = { kind: 'git-history', id: GIT_HISTORY_TAB_ID };
const branchTab: TabItem = { kind: 'git-branch', id: GIT_BRANCH_TAB_ID };
const commitA: TabItem = { kind: 'git-commit', id: gitCommitTabId('a1b2c3'), commit: 'a1b2c3' };

test('addGitHistoryTab / addGitBranchTab：单例不重复', () => {
  assert.deepEqual(addGitHistoryTab([fileA, historyTab]), [fileA, historyTab]);
  assert.deepEqual(addGitBranchTab([fileA, branchTab]), [fileA, branchTab]);
  const withHist = addGitHistoryTab([fileA]);
  assert.equal(withHist[1].id, GIT_HISTORY_TAB_ID);
  const withBranch = addGitBranchTab([fileA]);
  assert.equal(withBranch[1].id, GIT_BRANCH_TAB_ID);
});

test('gitCommitTabId / addGitCommitTab：同提交去重', () => {
  assert.deepEqual(addGitCommitTab([fileA], 'a1b2c3'), [fileA, commitA]);
  assert.deepEqual(addGitCommitTab([fileA, commitA], 'a1b2c3'), [fileA, commitA]); // 已存在 → 原样
});

test('Git 与同名文件可同时打开，关闭 Git 不移除文件', () => {
  const paths = ['git', 'git-history', 'git-branch', 'git-diff:a.ts', 'git-commit:a1b2c3', '-/git/history'];
  let tabs: TabItem[] = paths.reduce(addFileTab, [] as TabItem[]);
  tabs = addGitCommitTab(addGitDiffTab(addGitBranchTab(addGitHistoryTab(addGitTab(tabs))), 'a.ts'), 'a1b2c3');
  assert.equal(new Set(tabs.map((t) => t.id)).size, paths.length + 5);
  for (const path of paths) assert.equal(currentFilePath(tabs, path), path);
  for (const tab of tabs.filter((t) => t.kind !== 'file')) tabs = removeTabById(tabs, tab.id);
  assert.deepEqual(fileTabPaths(tabs), paths);
});
