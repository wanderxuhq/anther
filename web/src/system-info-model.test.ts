// web/src/system-info-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatLoad, formatUptime, usedBytes } from './system-info-model.ts';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

test('formatBytes：B/KB/MB/GB 与小数位规则', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1.5 * MB), '1.5 MB');
  assert.equal(formatBytes(100 * GB), '100 GB');
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatBytes(Number.NaN), '—');
});

test('usedBytes：已用不出现负数', () => {
  assert.equal(usedBytes(100, 40), 60);
  assert.equal(usedBytes(100, 120), 0);
  assert.equal(usedBytes(Number.NaN, 1), 0);
});

test('formatLoad：1/5/15 分钟固定两位小数，缺项补 0', () => {
  assert.equal(formatLoad([0.1234, 1, 2.5]), '0.12 1.00 2.50');
  assert.equal(formatLoad([]), '0.00 0.00 0.00');
  assert.equal(formatLoad([0.1, Number.NaN]), '0.10 — 0.00');
});

test('formatUptime：天/小时/分钟/秒的取舍', () => {
  const labels = { day: 'd', hour: 'h', minute: 'm', second: 's' };
  assert.equal(formatUptime(0, labels), '0s');
  assert.equal(formatUptime(59, labels), '59s');
  assert.equal(formatUptime(60, labels), '1m');
  assert.equal(formatUptime(3661, labels), '1h 1m');
  assert.equal(formatUptime(90061, labels), '1d 1h');
  assert.equal(formatUptime(-5, labels), '0s');
  assert.equal(formatUptime(Number.NaN, labels), '0s');
  assert.equal(formatUptime(90061, { day: '天', hour: '小时', minute: '分钟', second: '秒' }), '1天 1小时');
});
