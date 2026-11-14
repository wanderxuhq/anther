import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Model } from './api.ts';
import {
  agentModelStorageKey,
  loadStoredModel,
  modelKey,
  sameModel,
  storeModel,
  type ModelStorage,
} from './model-preference.ts';

const models: Model[] = [
  { id: 'deepseek-v4.1-flash-free', providerID: 'opencode', name: 'DeepSeek' },
  { id: 'gpt-5.6', providerID: 'opencode', name: 'GPT' },
];

function memoryStorage(initial: Record<string, string> = {}): ModelStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

test('uses a per-workspace storage key', () => {
  assert.equal(agentModelStorageKey(''), 'anther.agent.model:/');
  assert.equal(agentModelStorageKey('/'), 'anther.agent.model:/');
  assert.equal(agentModelStorageKey('/-/project/'), 'anther.agent.model:/-/project/');
});

test('loads a remembered model only when it is still available', () => {
  const storage = memoryStorage({ key: 'opencode/deepseek-v4.1-flash-free' });
  assert.equal(loadStoredModel('key', models, storage)?.id, 'deepseek-v4.1-flash-free');
  assert.equal(loadStoredModel('missing', models, storage), null);
  assert.equal(loadStoredModel('key', [models[1]], storage), null);
});

test('stores and clears the selected model', () => {
  const storage = memoryStorage();
  storeModel('key', models[0], storage);
  assert.equal(storage.data.key, 'opencode/deepseek-v4.1-flash-free');
  storeModel('key', null, storage);
  assert.equal(storage.data.key, undefined);
});

test('compares models by provider and id', () => {
  assert.equal(modelKey(models[0]), 'opencode/deepseek-v4.1-flash-free');
  assert.equal(sameModel(models[0], { ...models[0] }), true);
  assert.equal(sameModel(models[0], models[1]), false);
  assert.equal(sameModel(null, models[0]), false);
});
