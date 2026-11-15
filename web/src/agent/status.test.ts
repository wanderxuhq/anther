import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCompactionChunk, applyCompactionUpdate, noticeItem, type StatusItem } from './status.ts';

test('parses ACP notices with severity and detail', () => {
  assert.deepEqual(noticeItem({ severity: 'info', title: 'Heads up' }, 1, 'notice-1'), {
    kind: 'system',
    id: 'notice-1',
    text: 'Heads up',
    tone: 'info',
    time: 1,
  });
  assert.deepEqual(noticeItem({ severity: 'warning', title: 'Careful', description: ' Disk full ' }, 2, 'notice-2'), {
    kind: 'system',
    id: 'notice-2',
    text: 'Careful',
    detail: 'Disk full',
    tone: 'warning',
    time: 2,
  });
  assert.equal(noticeItem({ severity: 'error', title: '' }, 0, 'x'), null);
  assert.equal(noticeItem(null, 0, 'x'), null);
});

test('compaction updates upsert in place and preserve the summary', () => {
  const running = applyCompactionUpdate([], { compactionId: 'c1', status: 'in_progress' }, 10);
  assert.equal(running.length, 1);
  let item = running[0] as StatusItem;
  assert.equal(item.id, 'compaction:c1');
  assert.equal(item.textKey, 'agent.compaction.running');
  assert.equal(item.tone, 'compaction');

  const completed = applyCompactionUpdate(running, {
    compactionId: 'c1',
    status: 'completed',
    summary: [{ type: 'text', text: 'Short summary' }],
  }, 20);
  assert.equal(completed.length, 1);
  item = completed[0] as StatusItem;
  assert.equal(item.textKey, 'agent.compaction.completed');
  assert.equal(item.detail, 'Short summary');
  assert.equal(item.time, 10);

  const withNotice = [
    ...completed,
    noticeItem({ severity: 'info', title: 'Notice' }, 30, 'notice')!,
  ];
  const failed = applyCompactionUpdate(withNotice, { compactionId: 'c1', status: 'failed', error: 'boom' }, 40);
  assert.equal(failed.length, 2);
  item = failed[0] as StatusItem;
  assert.equal(item.textKey, 'agent.compaction.failed');
  assert.deepEqual(item.textParams, { error: 'boom' });
  assert.equal((failed[1] as StatusItem).text, 'Notice');

  const cleared = applyCompactionUpdate(completed, {
    compactionId: 'c1',
    status: 'completed',
    summary: null,
  }, 50);
  assert.equal((cleared[0] as StatusItem).detail, undefined);

  const cancelled = applyCompactionUpdate(completed, { compactionId: 'c1', status: 'cancelled' }, 60);
  assert.equal((cancelled[0] as StatusItem).textKey, 'agent.compaction.cancelled');

  const clearedError = applyCompactionUpdate(failed, { compactionId: 'c1', status: 'failed', error: null }, 70);
  assert.equal((clearedError[0] as StatusItem).textKey, 'agent.compaction.failedGeneric');
  assert.equal((clearedError[0] as StatusItem).textParams, undefined);

  const unknown = applyCompactionUpdate(completed, { compactionId: 'c1', status: 'paused' }, 80);
  assert.equal((unknown[0] as StatusItem).textKey, 'agent.compaction.unknown');
  assert.deepEqual((unknown[0] as StatusItem).textParams, { status: 'paused' });
});

test('compaction summary chunks create and append to an item', () => {
  let items = applyCompactionChunk([], {
    compactionId: 'c2',
    content: { type: 'text', text: 'Hello ' },
  }, 1);
  assert.equal(items.length, 1);
  assert.equal((items[0] as StatusItem).detail, 'Hello ');
  assert.equal((items[0] as StatusItem).textKey, 'agent.compaction.running');

  items = applyCompactionChunk(items, {
    compactionId: 'c2',
    content: { type: 'text', text: 'world' },
  }, 2);
  assert.equal((items[0] as StatusItem).detail, 'Hello world');

  items = applyCompactionChunk(items, {
    compactionId: 'c2',
    content: { type: 'resource_link', uri: 'file:///a', name: 'a.txt' },
  }, 3);
  assert.equal((items[0] as StatusItem).rich?.[0]?.type, 'resource_link');
  assert.equal((items[0] as StatusItem).detail, 'Hello world');

  assert.equal(applyCompactionChunk([], { compactionId: '', content: { type: 'text', text: 'x' } }, 1).length, 0);
  assert.equal(applyCompactionChunk([], { compactionId: 'c', content: null }, 1).length, 0);
});

test('compaction summaries can mix text and attachment blocks', () => {
  const items = applyCompactionUpdate([], {
    compactionId: 'c3',
    status: 'completed',
    summary: [
      { type: 'text', text: 'Summary: ' },
      { type: 'resource_link', uri: 'file:///notes.md', name: 'notes.md' },
    ],
  }, 1);
  const item = items[0] as StatusItem;
  assert.equal(item.detail, 'Summary: ');
  assert.equal(item.rich?.[0]?.type, 'resource_link');
});
