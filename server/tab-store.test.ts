// server/tab-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TabStore } from './tab-store.ts';

// 可控时钟
function makeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test('open 追加标签并记录持有；close 移除前台持有者后标签消失', () => {
  const { now, advance } = makeClock();
  const s = new TabStore(90_000, now);

  s.open('u1', 'a.ts');
  s.open('u1', 'b.ts');
  s.setFront('u1', 'a.ts');
  s.open('u2', 'a.ts');

  assert.deepEqual(s.list(), ['a.ts', 'b.ts']);

  // u2 关闭 a.ts：u1 活跃且前台持有 → 保留
  s.close('u2', 'a.ts');
  assert.deepEqual(s.list(), ['a.ts', 'b.ts']);

  // u1 关闭 a.ts：无活跃前台持有 → 移除
  s.close('u1', 'a.ts');
  assert.deepEqual(s.list(), ['b.ts']);
});

test('不活跃用户的前台持有被忽略', () => {
  const { now, advance } = makeClock();
  const s = new TabStore(90_000, now);

  s.open('u1', 'a.ts');
  s.setFront('u1', 'a.ts');

  advance(95_000); // u1 心跳超时 → 不活跃
  s.open('u2', 'a.ts');
  s.close('u2', 'a.ts'); // 忽略 u1 的前台持有
  assert.deepEqual(s.list(), []); // a.ts 被移除
});

test('心跳刷新活跃度；前台切换为单值', () => {
  const { now, advance } = makeClock();
  const s = new TabStore(90_000, now);

  s.open('u1', 'a.ts');
  s.setFront('u1', 'a.ts');
  advance(89_000);
  s.heartbeat('u1'); // 续命
  advance(5_000);
  s.open('u2', 'a.ts');
  s.close('u2', 'a.ts'); // u1 仍活跃 → 保留
  assert.deepEqual(s.list(), ['a.ts']);

  // 前台切走再关闭 → 无前台持有 → 移除
  s.setFront('u1', 'b.ts');
  s.open('u1', 'b.ts');
  s.close('u1', 'a.ts');
  assert.deepEqual(s.list(), ['b.ts']);
});

test('restore 仅在服务器列表为空时生效', () => {
  const s = new TabStore();
  assert.equal(s.restore(['x.ts', 'y.ts']), true);
  assert.deepEqual(s.list(), ['x.ts', 'y.ts']);
  assert.equal(s.restore(['z.ts']), false); // 已非空 → 拒绝
  assert.deepEqual(s.list(), ['x.ts', 'y.ts']);
});
