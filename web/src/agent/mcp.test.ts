import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadMcpServers,
  mcpStorageKey,
  parseKeyValueLines,
  parseLines,
  storeMcpServers,
  type McpServer,
} from './mcp.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const servers: McpServer[] = [
  { type: 'stdio', name: 'files', command: '/bin/files', args: ['--stdio'], env: [{ name: 'A', value: 'B' }] },
  { type: 'http', name: 'web', url: 'https://example.com/mcp', headers: [{ name: 'X', value: 'Y' }] },
];

test('round-trips MCP servers through storage', () => {
  const storage = new MemoryStorage();
  const key = mcpStorageKey('/');
  storeMcpServers(storage, key, servers);
  assert.deepEqual(loadMcpServers(storage, key), servers);
});

test('drops malformed storage entries', () => {
  const storage = new MemoryStorage();
  const key = mcpStorageKey('/');
  storage.setItem(key, 'not json');
  assert.deepEqual(loadMcpServers(storage, key), []);
  storage.setItem(key, JSON.stringify([
    { type: 'stdio', name: 'ok', command: 'x', args: [], env: [] },
    { type: 'stdio', name: 'bad' },
    { type: 'http', name: 'bad-url' },
    { type: 'nope', name: 'bad-type' },
  ]));
  assert.deepEqual(loadMcpServers(storage, key), [
    { type: 'stdio', name: 'ok', command: 'x', args: [], env: [] },
  ]);
});

test('parses line lists and key/value pairs', () => {
  assert.deepEqual(parseLines(' a \n\n b\r\nc '), ['a', 'b', 'c']);
  assert.deepEqual(parseKeyValueLines('A=B\n C = D \ninvalid\n=F', '='), [
    { name: 'A', value: 'B' },
    { name: 'C', value: 'D' },
  ]);
  assert.deepEqual(parseKeyValueLines('X: Y\nZ:W\nbad', ':'), [
    { name: 'X', value: 'Y' },
    { name: 'Z', value: 'W' },
  ]);
});

test('storage keys are workspace-specific', () => {
  assert.notEqual(mcpStorageKey('/'), mcpStorageKey('/other'));
  assert.match(mcpStorageKey('/'), /^anther:mcp:/);
});
