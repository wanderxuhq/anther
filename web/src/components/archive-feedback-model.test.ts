import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  feedbackGroup,
  feedbackScore,
  visibleFeedbackHostId,
  type FeedbackHost,
  type FeedbackSession,
} from './archive-feedback-model.ts';

const host = (id: number, overrides: Partial<FeedbackHost> = {}): FeedbackHost => ({
  id,
  path: 'bundle.zip',
  chain: [],
  priority: 0,
  ...overrides,
});
const sessions = (entries: Record<number, FeedbackSession>) =>
  (value: FeedbackHost) => entries[value.id];

test('feedbackGroup uses archive identity and keeps budget per root', () => {
  assert.equal(feedbackGroup(host(1, { chain: ['inner.zip'] }), undefined), feedbackGroup(host(2, { chain: ['inner.zip'] }), undefined));
  assert.notEqual(feedbackGroup(host(1, { chain: ['a.zip'] }), undefined), feedbackGroup(host(2, { chain: ['b.zip'] }), undefined));
  assert.equal(
    feedbackGroup(host(1, { chain: ['a.zip'] }), { limit: 'budget' }),
    feedbackGroup(host(2, { chain: ['b.zip'] }), { limit: 'budget' }),
  );
  assert.notEqual(
    feedbackGroup(host(1), { limit: 'budget' }),
    feedbackGroup(host(2, { path: 'other.zip' }), { limit: 'budget' }),
  );
});

test('feedbackScore prioritizes explicit priority and the matching entry', () => {
  assert.equal(feedbackScore(host(1, { priority: 3 }), undefined), 3);
  assert.equal(feedbackScore(host(1, { priority: 3, entry: 'a.db' }), { entry: 'a.db' }), 103);
  assert.equal(feedbackScore(host(1, { priority: 3, entry: 'a.db' }), { entry: 'b.db' }), 3);
  assert.equal(feedbackScore(host(1, { priority: 3 }), { entry: 'a.db' }), 3);
});

test('visibleFeedbackHostId picks the highest score and breaks ties by newest id', () => {
  const hosts = [host(1), host(2, { priority: 1 }), host(3, { priority: 1 })];
  assert.equal(visibleFeedbackHostId(hosts, 1, sessions({})), 3);
  assert.equal(visibleFeedbackHostId(hosts, 2, sessions({})), 3);
  assert.equal(visibleFeedbackHostId(hosts, 3, sessions({})), 3);
});

test('visibleFeedbackHostId applies entry ownership and isolates groups', () => {
  const hosts = [
    host(1, { entry: 'a.db', priority: 5 }),
    host(2, { entry: 'b.db', priority: 0 }),
    host(3, { path: 'other.zip', priority: 9 }),
  ];
  const session = sessions({ 1: { entry: 'b.db' }, 2: { entry: 'b.db' }, 3: { entry: 'x' } });
  assert.equal(visibleFeedbackHostId(hosts, 1, session), 2);
  assert.equal(visibleFeedbackHostId([...hosts, host(4, { path: 'missing.zip' })], 4, session), 4);
  assert.equal(visibleFeedbackHostId(hosts, 99, session), null);
});

test('budget feedback collapses nested chains of the same archive', () => {
  const hosts = [host(1, { chain: ['a.zip'], priority: 0 }), host(2, { chain: ['b.zip'], priority: 2 })];
  const session = sessions({ 1: { limit: 'budget' }, 2: { limit: 'budget' } });
  assert.equal(visibleFeedbackHostId(hosts, 1, session), 2);
  assert.equal(visibleFeedbackHostId(hosts, 2, session), 2);
});
