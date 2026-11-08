import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseArgs, staticDirFor, lanIPv4 } from './cli.ts';

// 测试文件在 <root>/server/，项目根 = 上一级
const rootDir = path.dirname(fileURLToPath(import.meta.url)) + '/..';

test('默认：当前目录、端口 3000、仅监听本机', () => {
  const a = parseArgs([]);
  assert.equal(a.dir, process.cwd());
  assert.equal(a.port, 3000);
  assert.equal(a.host, '127.0.0.1');
  assert.equal(a.detach, false);
});

test('解析目录、端口', () => {
  const a = parseArgs(['/tmp/foo', '--port', '8080']);
  assert.equal(a.dir, '/tmp/foo');
  assert.equal(a.port, 8080);
  assert.equal(a.attach, true);
});

test('--lan 监听所有网卡，--host 可覆盖', () => {
  assert.equal(parseArgs(['--lan']).host, '0.0.0.0');
  assert.equal(parseArgs(['--lan', '--host', '127.0.0.1']).host, '127.0.0.1');
  assert.equal(parseArgs(['--host', '127.0.0.1', '--lan']).host, '0.0.0.0');
});

test('--host 覆盖监听地址（IPv4 / IPv6 / 主机名）', () => {
  assert.equal(parseArgs(['--host', '127.0.0.1']).host, '127.0.0.1');
  assert.equal(parseArgs(['--host', '::']).host, '::');
  assert.equal(parseArgs(['--host', '::1']).host, '::1');
  assert.equal(parseArgs(['--host', 'localhost']).host, 'localhost');
});

test('--host 缺值或非法报错', () => {
  assert.throws(() => parseArgs(['--host']), /invalid --host/);
  assert.throws(() => parseArgs(['--host', '--port', '1']), /invalid --host/);
  assert.throws(() => parseArgs(['--host', 'http://example.com']), /invalid --host/);
});

test('--no-attach 关闭附加，--attach 恢复默认', () => {
  assert.equal(parseArgs(['--no-attach']).attach, false);
  assert.equal(parseArgs(['--attach', '--no-attach']).attach, false);
  assert.equal(parseArgs(['--no-attach', '--attach']).attach, true);
});

test('--detach：只卸载当前目录，不启动服务器', () => {
  const a = parseArgs(['/tmp/foo', '--detach', '--port', '8080']);
  assert.equal(a.dir, '/tmp/foo');
  assert.equal(a.port, 8080);
  assert.equal(a.detach, true);
});

test('未知选项报错', () => {
  assert.throws(() => parseArgs(['--unknown']), /unknown option/);
});

test('非法端口报错', () => {
  assert.throws(() => parseArgs(['--port', 'abc']));
});

test('staticDirFor 源码形态解析到 <root>/web', () => {
  assert.equal(
    staticDirFor(pathToFileURL(`${rootDir}/server/cli.ts`).href),
    path.join(rootDir, 'web'),
  );
});

test('staticDirFor 编译产物形态解析到 <root>/dist/web（锁定生产模式 500 缺陷）', () => {
  assert.equal(
    staticDirFor(pathToFileURL(`${rootDir}/dist/server/cli.js`).href),
    path.join(rootDir, 'dist/web'),
  );
});

test('lanIPv4：返回非空字符串或 null（绝不允许抛异常——启动日志不能被网络枚举带崩）', () => {
  let result: string | null;
  try {
    result = lanIPv4();
  } catch (e) {
    assert.fail(`lanIPv4 不应抛异常，实际抛了 ${e}`);
  }
  assert.ok(result === null || typeof result === 'string');
});
