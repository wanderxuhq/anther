import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SYSTEM_PROMPT,
  loadSystemPrompt,
  storeSystemPrompt,
  systemPromptStorageKey,
} from './system-prompt.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test('round-trips a trimmed system prompt', () => {
  const storage = new MemoryStorage();
  const key = systemPromptStorageKey('/');
  storeSystemPrompt(storage, key, '  Be concise.  ');
  assert.equal(storage.getItem(key), 'Be concise.');
  assert.equal(loadSystemPrompt(storage, key), 'Be concise.');
});

test('clears the prompt when storing blank text', () => {
  const storage = new MemoryStorage();
  const key = systemPromptStorageKey('/');
  storeSystemPrompt(storage, key, 'Keep this');
  storeSystemPrompt(storage, key, '   ');
  assert.equal(storage.getItem(key), null);
  assert.equal(loadSystemPrompt(storage, key), '');
});

test('ignores oversized stored or new prompts', () => {
  const storage = new MemoryStorage();
  const key = systemPromptStorageKey('/');
  storage.setItem(key, 'x'.repeat(MAX_SYSTEM_PROMPT + 1));
  assert.equal(loadSystemPrompt(storage, key), '');
  storeSystemPrompt(storage, key, 'ok');
  storeSystemPrompt(storage, key, 'x'.repeat(MAX_SYSTEM_PROMPT + 1));
  assert.equal(storage.getItem(key), 'ok');
});

test('storage keys are workspace-specific', () => {
  assert.notEqual(systemPromptStorageKey('/'), systemPromptStorageKey('/other'));
  assert.match(systemPromptStorageKey('/'), /^anther:systemPrompt:/);
});
