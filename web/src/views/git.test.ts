// web/src/views/git.test.ts
// GitView 的 DOM 无关纯逻辑：勾选切换 / 全选路径集 / 状态着色映射。
//
// 注意：node:test 的 --experimental-transform-types 只能加载 .ts，无法加载 .tsx
// （JSX 需完整编译，Node 24 不支持）。因此这里不从 './git.tsx' 做 ESM 导入，而是
// 读取 git.tsx 源码文本、按名字提取 4 个纯函数（它们无 JSX、无运行时依赖），strip
// 类型注解后求值拿到函数引用——测试的仍是 git.tsx 里的真实实现，仅绕过 ESM 绑定。
// 若未来重构改了函数名/签名，extractFunction 会直接抛「找不到」让测试失败，不会静默失真。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import type { GitStatus } from '../api.ts';

const FUNC_NAMES = ['togglePath', 'allPaths', 'selectedPaths', 'statusClass'] as const;

/** 从 git.tsx 源码中按 `export function NAME(` 起、括号配平提取整个函数文本 */
function extractFunction(src: string, name: string): string {
  const marker = `export function ${name}(`;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `git.tsx 中找不到纯函数 ${name}`);
  const open = src.indexOf('{', start + marker.length);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

const src = readFileSync(new URL('./git.tsx', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(FUNC_NAMES.map((n) => extractFunction(src, n)).join('\n')).replace(/\bexport\s+/g, '');
const { togglePath, allPaths, selectedPaths, statusClass } = new Function(
  `${code}; return { togglePath, allPaths, selectedPaths, statusClass };`,
)() as {
  togglePath: (selected: Set<string>, path: string) => Set<string>;
  allPaths: (status: GitStatus | null) => string[];
  selectedPaths: (status: GitStatus | null, selected: Set<string>) => string[];
  statusClass: (status: string) => string;
};

const status: GitStatus = {
  isRepo: true,
  changes: [
    { path: 'a.ts', status: 'M' },
    { path: 'b.ts', status: '??' },
    { path: 'c.ts', status: 'D' },
  ],
};

test('togglePath：点过的勾选取消，未点过的勾上', () => {
  assert.deepEqual([...togglePath(new Set(['a.ts']), 'a.ts')], []);
  assert.deepEqual([...togglePath(new Set(['a.ts']), 'b.ts')], ['a.ts', 'b.ts']);
});

test('allPaths / selectedPaths：提交路径 = 勾选 ∩ 当前改动', () => {
  assert.deepEqual(allPaths(status), ['a.ts', 'b.ts', 'c.ts']);
  assert.deepEqual(selectedPaths(status, new Set(['a.ts', 'gone.ts'])), ['a.ts']);
  assert.deepEqual(selectedPaths(status, new Set()), []);
});

test('statusClass：状态字母 → 着色类名', () => {
  assert.equal(statusClass('??'), 'untracked');
  assert.equal(statusClass('M'), 'modified');
  assert.equal(statusClass('A'), 'added');
  assert.equal(statusClass('D'), 'deleted');
  assert.equal(statusClass('R'), 'renamed');
});
