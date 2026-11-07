// server/system.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { collectSystemInfo } from './system.ts';

test('collectSystemInfo：返回真实系统字段', async () => {
  const info = await collectSystemInfo(process.cwd());
  assert.equal(info.hostname, os.hostname());
  assert.ok(Array.isArray(info.addresses));
  for (const address of info.addresses) {
    assert.equal(typeof address.interface, 'string');
    assert.equal(typeof address.address, 'string');
    assert.ok(address.family === 'IPv4' || address.family === 'IPv6');
    assert.equal(typeof address.internal, 'boolean');
  }
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

test('collectSystemInfo：枚举所有地址，非回环/IPv4 优先', async (t) => {
  const address = (family: string, value: string, internal: boolean) => ({
    address: value, family, internal, netmask: '', mac: '00:00:00:00:00:00', cidr: null,
  });
  t.mock.method(os, 'networkInterfaces', () => ({
    lo: [address('IPv4', '127.0.0.1', true)],
    wlan0: [address('IPv6', 'fe80::1', false), address('IPv4', '192.168.1.5', false)],
  }) as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>);
  const info = await collectSystemInfo(process.cwd());
  assert.deepEqual(info.addresses.map((item) => item.address), ['192.168.1.5', 'fe80::1', '127.0.0.1']);
  assert.deepEqual(info.addresses.map((item) => item.interface), ['wlan0', 'wlan0', 'lo']);
  assert.deepEqual(info.addresses.map((item) => item.internal), [false, false, true]);
});

test('collectSystemInfo：接口枚举失败时地址为空数组', async (t) => {
  t.mock.method(os, 'networkInterfaces', () => { throw new Error('denied'); });
  const info = await collectSystemInfo(process.cwd());
  assert.deepEqual(info.addresses, []);
});

test('collectSystemInfo：工作区不存在时仍返回信息，磁盘为 null', async () => {
  const missing = path.join(os.tmpdir(), `anther-missing-${process.pid}-${Date.now()}`);
  const info = await collectSystemInfo(missing);
  assert.equal(info.workspace, path.resolve(missing));
  assert.equal(info.disk, null);
  assert.ok(info.totalMem > 0);
});
