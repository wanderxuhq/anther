import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './cli.ts';

test('默认：当前目录、端口 3000、只读', () => {
  const a = parseArgs([]);
  assert.equal(a.port, 3000);
  assert.equal(a.allowWrites, false);
});

test('解析目录、端口、--rw', () => {
  const a = parseArgs(['/tmp/foo', '--port', '8080', '--rw']);
  assert.equal(a.dir, '/tmp/foo');
  assert.equal(a.port, 8080);
  assert.equal(a.allowWrites, true);
});

test('非法端口报错', () => {
  assert.throws(() => parseArgs(['--port', 'abc']));
});
