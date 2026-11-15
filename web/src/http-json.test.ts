import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonResponse } from './http-json.ts';

const makeError = (status: number, message: string) => Object.assign(new Error(message), { status });

test('returns parsed JSON for a successful response', async () => {
  const value = await readJsonResponse(new Response('{"ok":true}', { status: 200 }), makeError);
  assert.deepEqual(value, { ok: true });
});

test('returns text for a non-JSON successful body', async () => {
  assert.equal(await readJsonResponse(new Response('plain', { status: 200 }), makeError), 'plain');
});

test('returns undefined for an empty successful body', async () => {
  assert.equal(await readJsonResponse(new Response(null, { status: 204 }), makeError), undefined);
});

test('uses the server error field for failed responses', async () => {
  await assert.rejects(
    readJsonResponse(new Response('{"error":"disk full"}', { status: 500 }), makeError),
    (error: Error & { status?: number }) => error.message === 'disk full' && error.status === 500,
  );
});

test('falls back to statusText or HTTP status for failed responses', async () => {
  await assert.rejects(
    readJsonResponse(new Response('not json', { status: 502, statusText: 'Bad Gateway' }), makeError),
    (error: Error) => error.message === 'Bad Gateway',
  );
  await assert.rejects(
    readJsonResponse(new Response(null, { status: 500, statusText: '' }), makeError),
    (error: Error) => error.message === 'HTTP 500',
  );
});
