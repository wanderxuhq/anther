import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { HttpError } from './http-error.ts';
import { resolveWithinRoot } from './path-safety.ts';

const root = path.resolve('path-safety-root');

const fails = (fn: () => unknown, message: string) => assert.throws(fn, (error: unknown) =>
  error instanceof HttpError && error.status === 400 && error.message === message);

test('resolves nested workspace paths', () => {
  assert.equal(resolveWithinRoot(root, 'src/a.ts'), path.join(root, 'src/a.ts'));
  assert.equal(resolveWithinRoot(root, '.'), root);
  assert.equal(resolveWithinRoot(root, 'src/../b.ts'), path.join(root, 'b.ts'));
});

test('rejects lexical escapes with 400', () => {
  fails(() => resolveWithinRoot(root, '..'), 'path escapes root');
  fails(() => resolveWithinRoot(root, '../outside'), 'path escapes root');
  fails(() => resolveWithinRoot(root, 'sub/../../outside'), 'path escapes root');
});

test('rejects empty and non-string paths', () => {
  fails(() => resolveWithinRoot(root, ''), 'invalid path');
  fails(() => resolveWithinRoot(root, null as unknown as string), 'invalid path');
});

test('root "/" accepts any absolute path', () => {
  assert.equal(resolveWithinRoot('/', 'etc/passwd'), path.resolve('/etc/passwd'));
  assert.equal(resolveWithinRoot('/', '/etc/passwd'), path.resolve('/etc/passwd'));
  assert.equal(resolveWithinRoot('/', '.'), path.resolve('/'));
});
