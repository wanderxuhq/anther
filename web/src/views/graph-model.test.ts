// web/src/views/graph-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitCommit } from '../api.ts';
import { layoutGraph, parseDecorations, type GraphRow } from './graph-model.ts';

const mk = (hash: string, parents: string[]): GitCommit =>
  ({ hash, shortHash: hash.slice(0, 7), subject: '', author: '', time: 0, decorations: '', parents });

test('layoutGraph：线性历史 → 单泳道竖线', () => {
  const r: GraphRow[] = layoutGraph([mk('c', ['b']), mk('b', ['a']), mk('a', [])]);
  assert.deepEqual(r, [
    { col: 0, segs: [{ a: 0, b: 0 }] },
    { col: 0, segs: [{ a: 0, b: 0 }] },
    { col: 0, segs: [] },
  ]);
});

test('layoutGraph：一岔一合（merge 双父 → 新泳道 → 收拢回主线）', () => {
  // topo 序：M(merge) → D1(dev tip) → P1(main) → B(分岔点) → A(根)
  const r = layoutGraph([
    mk('M', ['P1', 'D1']),
    mk('D1', ['B']),
    mk('P1', ['B']),
    mk('B', ['A']),
    mk('A', []),
  ]);
  assert.deepEqual(r, [
    { col: 0, segs: [{ a: 0, b: 0 }, { a: 0, b: 1 }] },   // 合并点：主线向下 + 开新泳道
    { col: 1, segs: [{ a: 0, b: 0 }, { a: 1, b: 1 }] },   // dev tip：主线贯穿 + 自身竖线
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 0, b: 0 }] },   // main：dev 泳道贯穿 + 自身竖线
    { col: 0, segs: [{ a: 1, b: 0 }, { a: 0, b: 0 }] },   // 收拢：dev 泳道斜线汇入主线
    { col: 0, segs: [] },                                 // 根：无线段
  ]);
});

test('layoutGraph：合并提交父连回主线（合并点本身处于泳道 0）', () => {
  // topo 序：M → P1(main tip) → D1(dev tip) → B → A
  const r = layoutGraph([
    mk('M', ['P1', 'D1']),
    mk('P1', ['B']),
    mk('D1', ['B']),
    mk('B', ['A']),
    mk('A', []),
  ]);
  assert.deepEqual(r, [
    { col: 0, segs: [{ a: 0, b: 0 }, { a: 0, b: 1 }] },
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 0, b: 0 }] },
    { col: 1, segs: [{ a: 0, b: 0 }, { a: 1, b: 1 }] },
    { col: 0, segs: [{ a: 1, b: 0 }, { a: 0, b: 0 }] },
    { col: 0, segs: [] },
  ]);
});

test('layoutGraph：双岔双合（dev 两次合并进主线）', () => {
  // topo 序：M2 → C2 → M1 → D2 → C1 → D1 → B → A
  const r = layoutGraph([
    mk('M2', ['C2', 'D2']),
    mk('C2', ['M1']),
    mk('M1', ['C1', 'D1']),
    mk('D2', ['D1']),
    mk('C1', ['B']),
    mk('D1', ['B']),
    mk('B', ['A']),
    mk('A', []),
  ]);
  assert.deepEqual(r, [
    { col: 0, segs: [{ a: 0, b: 0 }, { a: 0, b: 1 }] },   // M2：主线向下 + 开新泳道
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 0, b: 0 }] },   // C2
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 0, b: 0 }, { a: 0, b: 2 }] }, // M1：再开第二岔
    { col: 1, segs: [{ a: 0, b: 0 }, { a: 2, b: 2 }, { a: 1, b: 1 }] }, // D2
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 2, b: 2 }, { a: 0, b: 0 }] }, // C1
    { col: 1, segs: [{ a: 0, b: 0 }, { a: 2, b: 1 }, { a: 1, b: 1 }] }, // D1：col2 收拢进 col1
    { col: 0, segs: [{ a: 1, b: 0 }, { a: 0, b: 0 }] },   // B：dev 泳道收拢回主线
    { col: 0, segs: [] },                                 // A：根
  ]);
});

test('layoutGraph：根提交无父 → 行内无竖线', () => {
  assert.deepEqual(layoutGraph([mk('a', [])]), [{ col: 0, segs: [] }]);
});

test('layoutGraph：空仓库 → 空数组', () => {
  assert.deepEqual(layoutGraph([]), []);
});

test('parseDecorations：HEAD 指针 / tag / 远端分支拆解', () => {
  assert.deepEqual(parseDecorations('HEAD -> main, origin/main, tag: v1.0'), {
    branches: ['main', 'origin/main'],
    tags: ['v1.0'],
  });
});

test('parseDecorations：空串 / 纯 HEAD / 纯 tag', () => {
  assert.deepEqual(parseDecorations(''), { branches: [], tags: [] });
  assert.deepEqual(parseDecorations('HEAD'), { branches: [], tags: [] });
  assert.deepEqual(parseDecorations('tag: v1, tag: v2'), { branches: [], tags: ['v1', 'v2'] });
});
