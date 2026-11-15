import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTimelineUpdate,
  applyTurnUsage,
  createTimeline,
  replayTimeline,
  type AssistantItem,
  type ChatItem,
} from './timeline.ts';

const updates = [
  { sessionUpdate: 'user_message_chunk', messageId: 'u1', content: { type: 'text', text: 'hello' } },
  { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: { type: 'text', text: 'hel' } },
  { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: { type: 'text', text: 'lo' } },
  { sessionUpdate: 'agent_thought_chunk', messageId: 'a1:reasoning:1', content: { type: 'text', text: 'think' } },
  {
    sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read', status: 'in_progress',
    rawInput: { path: 'a.ts' }, content: [{ type: 'content', content: { type: 'text', text: 'opening' } }],
  },
  {
    sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
  },
];

function assistant(items: ChatItem[]): AssistantItem {
  const item = items.find((entry) => entry.kind === 'assistant');
  assert.ok(item);
  return item as AssistantItem;
}

test('replay groups user/assistant/tool chunks by id', () => {
  const state = replayTimeline(updates, 10);
  assert.deepEqual(state.items.map((item) => item.kind), ['user', 'assistant']);
  const user = state.items[0];
  assert.equal(user.kind, 'user');
  assert.equal(user.text, 'hello');
  const reply = assistant(state.items);
  assert.equal(reply.text, 'hello');
  assert.equal(reply.reasoning, 'think');
  assert.equal(reply.tools.length, 1);
  assert.equal(reply.tools[0].status, 'completed');
  assert.equal(reply.tools[0].content, 'done');
});

test('incremental updates produce the same timeline as replay', () => {
  const state = createTimeline();
  for (const update of updates) applyTimelineUpdate(state, update, 10);
  assert.deepEqual(state.items, replayTimeline(updates, 10).items);
});

test('new message ids create separate items and a plan replaces the single plan entry', () => {
  const state = replayTimeline([
    ...updates,
    { sessionUpdate: 'plan', entries: [{ content: 'Step', priority: 'high', status: 'pending' }] },
    { sessionUpdate: 'agent_message_chunk', messageId: 'a2', content: { type: 'text', text: 'next' } },
  ], 10);
  assert.deepEqual(state.items.map((item) => item.kind), ['user', 'assistant', 'plan', 'assistant']);
  assert.equal((state.items[3] as AssistantItem).text, 'next');
});

test('prompt usage attaches to the latest assistant without losing the timeline', () => {
  const state = replayTimeline(updates, 10);
  applyTurnUsage(state, { cost: 0.1, tokens: { input: 3, output: 2 } });
  const reply = assistant(state.items);
  assert.deepEqual(reply.usage, { cost: 0.1, tokens: { input: 3, output: 2 } });
  applyTimelineUpdate(state, { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: { type: 'text', text: '!' } });
  assert.equal(assistant(state.items).usage?.cost, 0.1);
});
