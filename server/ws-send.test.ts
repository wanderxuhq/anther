import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendWsJson } from './ws-send.ts';

function socket(readyState: number) {
  const sent: string[] = [];
  return { readyState, sent, send: (data: string) => { sent.push(data); } };
}

test('sends a JSON frame while the socket is open', () => {
  const ws = socket(1);
  assert.equal(sendWsJson(ws, { type: 'pong' }), true);
  assert.deepEqual(ws.sent, ['{"type":"pong"}']);
});

test('skips frames when the socket is not open', () => {
  for (const state of [0, 2, 3]) {
    const ws = socket(state);
    assert.equal(sendWsJson(ws, { type: 'exit', code: 0 }), false);
    assert.deepEqual(ws.sent, []);
  }
});

test('skips values JSON cannot serialize', () => {
  const ws = socket(1);
  assert.equal(sendWsJson(ws, undefined), false);
  assert.deepEqual(ws.sent, []);
});
