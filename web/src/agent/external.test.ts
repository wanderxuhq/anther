import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalHttpUrl } from './external.ts';

test('accepts http and https URLs', () => {
  assert.equal(externalHttpUrl('https://example.com/oauth?x=1')?.host, 'example.com');
  assert.equal(externalHttpUrl('  http://127.0.0.1:3000/connect ')?.host, '127.0.0.1:3000');
});

test('rejects unsafe or malformed URLs', () => {
  assert.equal(externalHttpUrl('javascript:alert(1)'), null);
  assert.equal(externalHttpUrl('file:///etc/passwd'), null);
  assert.equal(externalHttpUrl('data:text/html,hi'), null);
  assert.equal(externalHttpUrl('not a url'), null);
  assert.equal(externalHttpUrl(''), null);
  assert.equal(externalHttpUrl(null), null);
});
