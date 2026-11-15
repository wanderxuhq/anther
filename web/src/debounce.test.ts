import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDebounce } from './debounce.ts';

test('restarts the delay and runs the latest callback once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runs: number[] = [];
  const debounce = createDebounce(180);
  debounce.schedule(() => runs.push(1));
  t.mock.timers.tick(100);
  debounce.schedule(() => runs.push(2));
  t.mock.timers.tick(179);
  assert.deepEqual(runs, []);
  t.mock.timers.tick(1);
  assert.deepEqual(runs, [2]);
});

test('cancel drops the pending run', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const debounce = createDebounce(180);
  debounce.schedule(() => { calls++; });
  debounce.cancel();
  t.mock.timers.tick(1_000);
  assert.equal(calls, 0);
});

test('a new schedule after cancel still runs', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const debounce = createDebounce(120);
  debounce.schedule(() => { calls++; });
  debounce.cancel();
  debounce.schedule(() => { calls++; });
  t.mock.timers.tick(120);
  assert.equal(calls, 1);
});

test('cancel after firing is a safe no-op', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const debounce = createDebounce(10);
  debounce.schedule(() => { calls++; });
  t.mock.timers.tick(10);
  debounce.cancel();
  assert.equal(calls, 1);
});
