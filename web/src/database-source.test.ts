import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteSource } from './database/sqlite-source.ts';
import { ApiError } from './api.ts';

beforeEach((t) => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'test-user' } });
  t.after(() => {
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else delete (globalThis as Record<string, unknown>).localStorage;
  });
});

test('SQLite source preserves JSON data and server errors', async (t) => {
  const result = { objects: [{ name: 'users', type: 'table' }], truncated: false };
  t.mock.method(globalThis, 'fetch', async () => Response.json(result));
  const source = createSqliteSource('app.db');
  t.after(() => source.dispose());
  assert.deepEqual(await source.listObjects(), result);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'database is locked' }, { status: 400 }));
  await assert.rejects(source.listObjects(), (error: unknown) =>
    error instanceof ApiError && error.status === 400 && error.message === 'database is locked');
});

test('empty, malformed and missing JSON results produce useful errors instead of JSON parser exceptions', async (t) => {
  const source = createSqliteSource('app.db');
  t.after(() => source.dispose());
  for (const [body, status, expectedStatus, message] of [
    ['', 200, 502, 'empty response'],
    ['', 500, 500, 'empty response'],
    ['<html>Bad Gateway</html>', 502, 502, 'invalid JSON response'],
    ['{"objects":', 200, 502, 'invalid JSON response'],
    ['null', 200, 502, 'invalid response'],
  ] as const) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status }));
    await assert.rejects(source.listObjects(), (error: unknown) =>
      error instanceof ApiError && error.status === expectedStatus && error.message.includes(message));
  }
});

test('cancellation while receiving the JSON body remains an abort', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => ({
    ok: true, status: 200,
    text: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  }));
  const source = createSqliteSource('app.db');
  const pending = source.listObjects();
  await Promise.resolve();
  source.dispose();
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
});
