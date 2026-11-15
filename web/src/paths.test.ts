// web/src/paths.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parentOf, isValidName, pathSegments } from './paths.ts';

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
test('pathSegments', () => {
  assert.deepEqual(pathSegments('src/a.ts'), ['src', 'a.ts']);
  assert.deepEqual(pathSegments('src/a.ts', false), ['src']);
  assert.deepEqual(pathSegments('a.ts', false), []);
  assert.deepEqual(pathSegments('/a/b/'), ['a', 'b']);
});
