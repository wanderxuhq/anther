// web/src/base.test.ts
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { basePath, setBasePath, withBase } from './base.ts';

afterEach(() => setBasePath(''));

test('withBase：根路径原样，挂载路径加前缀且不重复', () => {
  setBasePath('');
  assert.equal(basePath(), '');
  assert.equal(withBase('/api/list'), '/api/list');

  setBasePath('/-/qlang/');
  assert.equal(basePath(), '/-/qlang');
  assert.equal(withBase('/api/list'), '/-/qlang/api/list');
  assert.equal(withBase('/-/qlang/api/list'), '/-/qlang/api/list');
  assert.equal(withBase('https://example.com/api'), 'https://example.com/api');
  assert.equal(withBase('//cdn.example.com/x'), '//cdn.example.com/x');
  assert.equal(withBase('api/list'), 'api/list');
});

test('setBasePath：非绝对或协议相对值回退为空，根斜杠归一化为空', () => {
  setBasePath('https://evil.example');
  assert.equal(basePath(), '');
  setBasePath('//evil.example');
  assert.equal(basePath(), '');
  setBasePath('/-/x/');
  assert.equal(basePath(), '/-/x');
  setBasePath('/');
  assert.equal(basePath(), '');
});
