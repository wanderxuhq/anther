import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseArgs, staticDirFor } from './cli.ts';

// 测试文件在 <root>/server/，项目根 = 上一级
const rootDir = path.dirname(fileURLToPath(import.meta.url)) + '/..';

test('默认：当前目录、端口 3000', () => {
  const a = parseArgs([]);
  assert.equal(a.dir, process.cwd());
  assert.equal(a.port, 3000);
});

test('解析目录、端口', () => {
  const a = parseArgs(['/tmp/foo', '--port', '8080']);
  assert.equal(a.dir, '/tmp/foo');
  assert.equal(a.port, 8080);
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
