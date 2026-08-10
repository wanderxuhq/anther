// web/src/views/history-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCommitTime, logParams } from './history-model.ts';

const NOW = 1_700_000_000_000;

test('formatCommitTime：刚刚/分/时/天/日期 分桶', () => {
  assert.deepEqual(formatCommitTime(NOW, NOW), { kind: 'justNow', n: 0 });
  assert.deepEqual(formatCommitTime(NOW - 30_000, NOW), { kind: 'justNow', n: 0 });
  assert.deepEqual(formatCommitTime(NOW - 5 * 60_000, NOW), { kind: 'minute', n: 5 });
  assert.deepEqual(formatCommitTime(NOW - 3 * 3_600_000, NOW), { kind: 'hour', n: 3 });
  assert.deepEqual(formatCommitTime(NOW - 2 * 86_400_000, NOW), { kind: 'day', n: 2 });
  assert.deepEqual(formatCommitTime(NOW - 30 * 86_400_000, NOW), { kind: 'date', n: 0 });
});

test('logParams：缺省分支省略 / limit 钳制 [1,100] / skip 非负', () => {
  assert.deepEqual(logParams(null, 50, 0), { limit: 50, skip: 0 });
  assert.deepEqual(logParams('dev', 50, 0), { branch: 'dev', limit: 50, skip: 0 });
  assert.deepEqual(logParams('main', 999, -5), { branch: 'main', limit: 100, skip: 0 });
  assert.deepEqual(logParams(null, 0, 0), { limit: 1, skip: 0 });
});
