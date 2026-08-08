// server/http-error.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http-error.ts';

test('HttpError 携带状态码与消息', () => {
  const err = new HttpError(403, 'read-only');
  assert.equal(err.status, 403);
  assert.equal(err.message, 'read-only');
  assert.ok(err instanceof Error);
});
