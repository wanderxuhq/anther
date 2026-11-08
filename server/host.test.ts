import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, isValidHost, isWildcardHost } from './host.ts';

test('isWildcardHost：通配地址', () => {
  assert.equal(isWildcardHost('0.0.0.0'), true);
  assert.equal(isWildcardHost('::'), true);
  assert.equal(isWildcardHost('[::]'), true);
  assert.equal(isWildcardHost('127.0.0.1'), false);
  assert.equal(isWildcardHost('192.168.1.5'), false);
});

test('isLoopbackHost：回环地址', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
});

test('isValidHost：只接受裸地址，不接受 URL/空值/选项', () => {
  for (const value of ['127.0.0.1', '0.0.0.0', '::', '::1', 'localhost', '192.168.1.5', 'my-host.local']) {
    assert.equal(isValidHost(value), true, value);
  }
  for (const value of ['', '--lan', 'http://example.com', 'a b', '0.0.0.0/24', null, undefined, 42]) {
    assert.equal(isValidHost(value), false, String(value));
  }
});
