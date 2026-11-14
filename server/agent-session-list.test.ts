import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSessionPages, type SessionPage } from './agent-session-list.ts';

type Session = { sessionId: string; title?: string };

test('collects every cursor page', async () => {
  const pages: Record<string, SessionPage<Session>> = {
    '': { sessions: [{ sessionId: 'a' }, { sessionId: 'b' }], nextCursor: 'p2' },
    p2: { sessions: [{ sessionId: 'c' }] },
  };
  const cursors: Array<string | undefined> = [];
  const found = await collectSessionPages(async (cursor) => {
    cursors.push(cursor);
    return pages[cursor ?? ''];
  });
  assert.deepEqual(found.map((session) => session.sessionId), ['a', 'b', 'c']);
  assert.deepEqual(cursors, [undefined, 'p2']);
});

test('deduplicates sessions that appear on more than one page', async () => {
  const found = await collectSessionPages(async (cursor) =>
    cursor === undefined
      ? { sessions: [{ sessionId: 'a' }, { sessionId: 'b' }], nextCursor: 'p2' }
      : { sessions: [{ sessionId: 'b' }, { sessionId: 'c' }] });
  assert.deepEqual(found.map((session) => session.sessionId), ['a', 'b', 'c']);
});

test('stops when an agent repeats a cursor', async () => {
  let calls = 0;
  const found = await collectSessionPages(async () => {
    calls++;
    return { sessions: [{ sessionId: `s${calls}` }], nextCursor: 'same' };
  });
  assert.equal(calls, 2);
  assert.deepEqual(found.map((session) => session.sessionId), ['s1', 's2']);
});

test('stops at the page limit', async () => {
  let calls = 0;
  const found = await collectSessionPages(async () => {
    calls++;
    return { sessions: [{ sessionId: `s${calls}` }], nextCursor: `p${calls}` };
  }, 3);
  assert.equal(calls, 3);
  assert.equal(found.length, 3);
});
