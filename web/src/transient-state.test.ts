import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransientValue } from './transient-state.ts';

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

test('show publishes the value and schedules expiry', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const value = createTransientValue<string>((next) => changes.push(next), scheduler, 1500);
  value.show('a.txt');
  assert.deepEqual(changes, ['a.txt']);
  assert.deepEqual([...scheduler.jobs.values()].map((job) => job.delayMs), [1500]);
});

test('show replaces the pending expiry', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const value = createTransientValue<string>((next) => changes.push(next), scheduler, 1500);
  value.show('a.txt');
  value.show('b.txt');
  assert.deepEqual(changes, ['a.txt', 'b.txt']);
  assert.equal(scheduler.jobs.size, 1);
});

test('expiry publishes null once', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const value = createTransientValue<string>((next) => changes.push(next), scheduler, 1500);
  value.show('a.txt');
  scheduler.fire();
  assert.deepEqual(changes, ['a.txt', null]);
});

test('clear cancels the pending expiry and publishes null', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const value = createTransientValue<string>((next) => changes.push(next), scheduler, 1500);
  value.show('a.txt');
  value.clear();
  assert.deepEqual(changes, ['a.txt', null]);
  assert.equal(scheduler.jobs.size, 0);
  scheduler.fire();
  assert.deepEqual(changes, ['a.txt', null]);
});

test('clear while idle does not publish', () => {
  const scheduler = fakeScheduler();
  const changes: Array<string | null> = [];
  const value = createTransientValue<string>((next) => changes.push(next), scheduler, 1500);
  value.clear();
  assert.deepEqual(changes, []);
});
