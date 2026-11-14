import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEntries, upsertPlan, type PlanItem } from './plan.ts';

test('parses plan entries', () => {
  const entries = planEntries({
    entries: [
      { content: 'Inspect the code', priority: 'high', status: 'completed' },
      { content: 'Write the fix', priority: 'medium', status: 'in_progress' },
      { content: 'Run tests', priority: 'low', status: 'pending' },
    ],
  });
  assert.deepEqual(entries, [
    { content: 'Inspect the code', priority: 'high', status: 'completed' },
    { content: 'Write the fix', priority: 'medium', status: 'in_progress' },
    { content: 'Run tests', priority: 'low', status: 'pending' },
  ]);
});

test('normalizes unknown priority and status values', () => {
  const entries = planEntries({
    entries: [
      { content: 'Unknown', priority: 'urgent', status: 'blocked' },
      { content: 'Missing' },
    ],
  });
  assert.deepEqual(entries, [
    { content: 'Unknown', priority: 'medium', status: 'pending' },
    { content: 'Missing', priority: 'medium', status: 'pending' },
  ]);
});

test('rejects malformed plan payloads', () => {
  assert.equal(planEntries(undefined), null);
  assert.equal(planEntries(null), null);
  assert.equal(planEntries({}), null);
  assert.equal(planEntries({ entries: 'nope' }), null);
});

test('accepts an empty plan update', () => {
  assert.deepEqual(planEntries({ entries: [] }), []);
});

test('replaces one existing plan item instead of appending', () => {
  const previous: Array<{ kind: string; id: string }> = [
    { kind: 'user', id: 'u1' },
    { kind: 'plan', id: 'plan' },
    { kind: 'assistant', id: 'a1' },
  ];
  const next: PlanItem = {
    kind: 'plan',
    id: 'plan',
    entries: [{ content: 'Next', priority: 'high', status: 'pending' }],
    time: 1,
  };
  const result = upsertPlan(previous, next);
  assert.equal(result.length, previous.length);
  assert.equal(result[1], next);
});

test('appends the first plan item', () => {
  const next: PlanItem = {
    kind: 'plan',
    id: 'plan',
    entries: [],
    time: 1,
  };
  const result = upsertPlan([{ kind: 'user', id: 'u1' }], next);
  assert.deepEqual(result, [{ kind: 'user', id: 'u1' }, next]);
});
