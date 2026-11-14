import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DiscoveredAgent } from './api.ts';
import {
  agentRuntimeStorageKey,
  loadStoredAgent,
  storeAgent,
  type AgentStorage,
} from './agent-preference.ts';

const agents: DiscoveredAgent[] = [
  { id: 'opencode', name: 'OpenCode', selected: true },
  { id: 'command-code', name: 'Command Code', selected: false },
];

function memoryStorage(initial: Record<string, string> = {}): AgentStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

test('uses a per-workspace runtime-agent key', () => {
  assert.equal(agentRuntimeStorageKey(''), 'anther.agent.runtime:/');
  assert.equal(agentRuntimeStorageKey('/-/project/'), 'anther.agent.runtime:/-/project/');
});

test('loads a remembered agent only when it is still available', () => {
  const storage = memoryStorage({ key: 'command-code' });
  assert.equal(loadStoredAgent('key', agents, storage), 'command-code');
  assert.equal(loadStoredAgent('missing', agents, storage), null);
  assert.equal(loadStoredAgent('key', [agents[0]], storage), null);
});

test('stores and clears the selected agent', () => {
  const storage = memoryStorage();
  storeAgent('key', 'command-code', storage);
  assert.equal(storage.data.key, 'command-code');
  storeAgent('key', null, storage);
  assert.equal(storage.data.key, undefined);
});
