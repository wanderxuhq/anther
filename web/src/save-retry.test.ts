import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeWithRetry } from './save-retry.ts';

test('retries until success with the configured attempt budget', async () => {
  let calls = 0;
  await writeWithRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('not yet');
  }, { debounceMs: 0, retryMs: 0, attempts: 3 });
  assert.equal(calls, 3);
});

test('rethrows the last failure after exhausting the attempts', async () => {
  let calls = 0;
  await assert.rejects(writeWithRetry(async () => {
    calls++;
    throw new Error(`fail ${calls}`);
  }, { debounceMs: 0, retryMs: 0, attempts: 3 }), /fail 3/);
  assert.equal(calls, 3);
});

test('does not retry a write that succeeds immediately', async () => {
  let calls = 0;
  await writeWithRetry(async () => { calls++; }, { debounceMs: 0, retryMs: 0, attempts: 3 });
  assert.equal(calls, 1);
});
