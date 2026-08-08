// server/write-gate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertWritable } from './write-gate.ts';
import { HttpError } from './http-error.ts';

test('ro=0 放行（前端编辑模式可写）', () => {
  assertWritable('0'); // 不抛
});

test('ro=1 或缺失 → 403（只读模式拒绝写入）', () => {
  assert.throws(() => assertWritable('1'), (e: HttpError) => e.status === 403);
  assert.throws(() => assertWritable(undefined), (e: HttpError) => e.status === 403);
});
