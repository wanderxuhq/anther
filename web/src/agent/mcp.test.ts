import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMcpServers, wireMcpServers } from '../../../server/mcp.ts';
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

test('round-trips the actual server wire shape', () => {
  const storage = new MemoryStorage();
  const key = mcpStorageKey('/');
  const wire = wireMcpServers(normalizeMcpServers([
    { type: 'stdio', name: 'files', command: 'files', args: ['--stdio'], env: [{ name: 'A', value: 'B' }] },
    { type: 'http', name: 'web', url: 'https://example.com/mcp', headers: [] },
    { type: 'sse', name: 'events', url: 'https://example.com/sse', headers: [] },
  ]));
  assert.equal(wire[0]?.type, 'stdio');
  storeMcpServers(storage, key, wire);
  assert.deepEqual(loadMcpServers(storage, key), wire);
});

test('accepts type-less stdio entries from older snapshots', () => {
  const storage = new MemoryStorage();
  const key = mcpStorageKey('/');
  storage.setItem(key, JSON.stringify([
    { name: 'legacy', command: 'legacy-cmd', args: ['--x'], env: [] },
  ]));
  assert.deepEqual(loadMcpServers(storage, key), [
    { type: 'stdio', name: 'legacy', command: 'legacy-cmd', args: ['--x'], env: [] },
  ]);
});

test('drops malformed storage entries and duplicate names', () => {
  const storage = new MemoryStorage();
  const key = mcpStorageKey('/');
  storage.setItem(key, 'not json');
  assert.deepEqual(loadMcpServers(storage, key), []);
  storage.setItem(key, JSON.stringify([
    { type: 'stdio', name: 'ok', command: 'x', args: [], env: [] },
    { type: 'stdio', name: 'ok', command: 'y', args: [], env: [] },
    { type: 'stdio', name: 'bad' },
    { type: 'http', name: 'bad-url', url: 'file:///etc/passwd' },
    { type: 'http', name: 'bad-header', url: 'https://x', headers: [{ name: 'X\nInjected', value: 'y' }] },
    { type: 'nope', name: 'bad-type' },
  ]));
  assert.deepEqual(loadMcpServers(storage, key), [
    { type: 'stdio', name: 'ok', command: 'x', args: [], env: [] },
  ]);
});

test('caps the number of stored servers', () => {
  const storage = new MemoryStorage();
  const key = mcpStorageKey('/');
  storage.setItem(key, JSON.stringify(Array.from({ length: 25 }, (_, index) => ({
    type: 'stdio', name: `s${index}`, command: 'x', args: [], env: [],
  }))));
  assert.equal(loadMcpServers(storage, key).length, 20);
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
