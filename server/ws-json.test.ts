import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWsJson } from '../shared/ws-json.ts';

test('parses JSON objects from strings and buffers', () => {
  assert.deepEqual(parseWsJson('{"type":"ping"}'), { type: 'ping' });
  assert.deepEqual(parseWsJson(Buffer.from('{"cols":80}')), { cols: 80 });
});

test('malformed frames are ignored', () => {
  assert.equal(parseWsJson('not json'), null);
  assert.equal(parseWsJson(''), null);
});

test('non-object frames are ignored', () => {
  assert.equal(parseWsJson('null'), null);
  assert.equal(parseWsJson('[]'), null);
  assert.equal(parseWsJson('"text"'), null);
  assert.equal(parseWsJson('42'), null);
});
