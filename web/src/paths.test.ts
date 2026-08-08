// web/src/paths.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parentOf, isValidName } from './paths.ts';

test('parentOf', () => {
  assert.equal(parentOf('a/b/c'), 'a/b');
  assert.equal(parentOf('a'), '.');
  assert.equal(parentOf('a/b'), 'a');
});
test('isValidName', () => {
  assert.equal(isValidName('a.ts'), true);
  assert.equal(isValidName(''), false);
  assert.equal(isValidName('a/b'), false);
  assert.equal(isValidName('.'), false);
  assert.equal(isValidName('..'), false);
});
