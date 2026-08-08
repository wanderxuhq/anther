// server/write-gate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WriteGate } from './write-gate.ts';
import { HttpError } from './http-error.ts';

test('未开 --rw 时所有写入拒绝（即使 ro=0）', () => {
  const gate = new WriteGate(false);
  assert.throws(() => gate.assertWritable('0'), (e: HttpError) => e.status === 403);
  assert.throws(() => gate.assertWritable(undefined), (e: HttpError) => e.status === 403);
});

test('开 --rw 后 ro=1 或缺失拒绝，ro=0 放行', () => {
  const gate = new WriteGate(true);
  gate.assertWritable('0'); // 不抛
  assert.throws(() => gate.assertWritable('1'), (e: HttpError) => e.status === 403);
  assert.throws(() => gate.assertWritable(undefined), (e: HttpError) => e.status === 403);
});
