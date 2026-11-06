// server/system.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { collectSystemInfo } from './system.ts';

test('collectSystemInfo：返回真实系统字段', async () => {
  const info = await collectSystemInfo(process.cwd());
  assert.equal(info.hostname, os.hostname());
  assert.equal(info.type, os.type());
  assert.equal(info.platform, os.platform());
  assert.equal(info.release, os.release());
  assert.equal(info.arch, os.arch());
  assert.equal(info.node, process.version);
  assert.equal(info.workspace, path.resolve(process.cwd()));
  assert.ok(info.uptime >= 0);
  assert.ok(info.processUptime >= 0);
  assert.ok(info.cpuCount >= 1);
  assert.ok(info.cpuModel.length > 0);
  assert.equal(info.loadavg.length, 3);
  assert.ok(info.totalMem > 0);
  assert.ok(info.freeMem >= 0);
  assert.match(info.version, /^\d+\.\d+\.\d+(?:[-+].*)?$/);
  if (info.disk) {
    assert.ok(info.disk.total > 0);
    assert.ok(info.disk.free >= 0);
    assert.ok(info.disk.free <= info.disk.total);
  }
});

test('collectSystemInfo：工作区不存在时仍返回信息，磁盘为 null', async () => {
  const missing = path.join(os.tmpdir(), `anther-missing-${process.pid}-${Date.now()}`);
  const info = await collectSystemInfo(missing);
  assert.equal(info.workspace, path.resolve(missing));
  assert.equal(info.disk, null);
  assert.ok(info.totalMem > 0);
});
