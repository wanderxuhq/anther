import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeleteConfirm, DELETE_CONFIRM_MS } from './filetree-delete.ts';

function fakeScheduler() {
  let next = 1;
  const jobs = new Map<number, { run: () => void; delayMs: number }>();
  return {
    jobs,
    schedule(run: () => void, delayMs: number): unknown {
      const id = next++;
      jobs.set(id, { run, delayMs });
      return id;
    },
    cancel(handle: unknown): void {
      jobs.delete(handle as number);
    },
    fire(): void {
      const pending = [...jobs.values()];
      jobs.clear();
      for (const job of pending) job.run();
    },
  };
}

test('first tap arms the path and schedules expiry', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const confirm = createDeleteConfirm((path) => changes.push(path), scheduler);
  assert.equal(confirm.tap('a.txt'), 'armed');
  assert.deepEqual(changes, ['a.txt']);
  assert.deepEqual([...scheduler.jobs.values()].map((job) => job.delayMs), [DELETE_CONFIRM_MS]);
});

test('second tap on the same path confirms and cancels expiry', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const confirm = createDeleteConfirm((path) => changes.push(path), scheduler);
  confirm.tap('a.txt');
  assert.equal(confirm.tap('a.txt'), 'confirmed');
  assert.deepEqual(changes, ['a.txt', null]);
  assert.equal(scheduler.jobs.size, 0);
});

test('tapping another path re-arms and replaces the pending expiry', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const confirm = createDeleteConfirm((path) => changes.push(path), scheduler);
  confirm.tap('a.txt');
  assert.equal(confirm.tap('b.txt'), 'armed');
  assert.deepEqual(changes, ['a.txt', 'b.txt']);
  assert.equal(scheduler.jobs.size, 1);
});

test('expiry clears the armed path once', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const confirm = createDeleteConfirm((path) => changes.push(path), scheduler);
  confirm.tap('a.txt');
  scheduler.fire();
  assert.deepEqual(changes, ['a.txt', null]);
  // After expiry the same path needs a fresh first tap.
  assert.equal(confirm.tap('a.txt'), 'armed');
});

test('reset cancels expiry and clears an armed path', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const confirm = createDeleteConfirm((path) => changes.push(path), scheduler);
  confirm.tap('a.txt');
  confirm.reset();
  assert.deepEqual(changes, ['a.txt', null]);
  assert.equal(scheduler.jobs.size, 0);
  scheduler.fire();
  assert.deepEqual(changes, ['a.txt', null]);
});

test('reset while idle does not notify', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const confirm = createDeleteConfirm((path) => changes.push(path), scheduler);
  confirm.reset();
  assert.deepEqual(changes, []);
});
