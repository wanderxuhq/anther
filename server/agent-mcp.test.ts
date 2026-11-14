import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentRuntime } from './agent.ts';
import type { DiscoveredAgent } from './agent-profiles.ts';
import { FileStore } from './files.ts';
import { filterMcpServers, normalizeMcpServers } from './mcp.ts';

test('normalizes stdio, HTTP and SSE MCP servers', () => {
  assert.deepEqual(normalizeMcpServers([
    { name: 'files', command: '/bin/files', args: ['--stdio'], env: [{ name: 'A', value: 'B' }] },
    { type: 'http', name: 'web', url: 'https://example.com/mcp', headers: [{ name: 'X', value: 'Y' }] },
    { type: 'sse', name: 'events', url: 'https://example.com/sse', headers: [] },
  ]), [
    { name: 'files', command: '/bin/files', args: ['--stdio'], env: [{ name: 'A', value: 'B' }] },
    { type: 'http', name: 'web', url: 'https://example.com/mcp', headers: [{ name: 'X', value: 'Y' }] },
    { type: 'sse', name: 'events', url: 'https://example.com/sse', headers: [] },
  ]);
});

test('rejects malformed and duplicate MCP configs', () => {
  assert.throws(() => normalizeMcpServers([{}]), /name is required/);
  assert.throws(() => normalizeMcpServers([{ name: 'a' }]), /command or url is required/);
  assert.throws(() => normalizeMcpServers([
    { name: 'a', command: 'x' },
    { name: 'a', command: 'y' },
  ]), /duplicate MCP server name/);
  assert.throws(() => normalizeMcpServers([{ type: 'http', name: 'a', url: 'https://x' }, { type: 'sse', name: 'a', url: 'https://y' }]), /duplicate/);
});

test('filters transports the agent does not advertise', () => {
  const servers = normalizeMcpServers([
    { name: 'stdio', command: 'x' },
    { type: 'http', name: 'http', url: 'https://x' },
    { type: 'sse', name: 'sse', url: 'https://y' },
  ]);
  assert.deepEqual(filterMcpServers(servers, { http: true, sse: false }).map((server) => server.name), ['stdio', 'http']);
  assert.deepEqual(filterMcpServers(servers, undefined).map((server) => server.name), ['stdio']);
});

const fakeAgent = String.raw`
const readline = require('node:readline');
const fs = require('node:fs/promises');
const marker = process.argv[2];
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, mcpCapabilities: { http: true, sse: false }, sessionCapabilities: { list: {} } },
        agentInfo: { name: 'MCP Fake', version: '1' },
      });
      break;
    case 'session/new':
      await fs.writeFile(marker, JSON.stringify(message.params.mcpServers || []), 'utf8');
      respond(message.id, { sessionId: 'sess_mcp', configOptions: [] });
      break;
    case 'session/list':
      respond(message.id, { sessions: [] });
      break;
    case 'session/load':
      respond(message.id, { configOptions: [] });
      break;
    default:
      if (message.id !== undefined) respond(message.id, {});
  }
});
`;

let root: string;
let marker: string;
let runtime: AgentRuntime;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-mcp-'));
  marker = path.join(root, 'mcp.json');
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-mcp', name: 'Fake MCP', command: process.execPath, args: [script, marker] },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root), () => normalizeMcpServers([
    { name: 'stdio', command: 'x' },
    { type: 'http', name: 'http', url: 'https://x' },
    { type: 'sse', name: 'sse', url: 'https://y' },
  ]));
});

afterEach(async () => {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
});

test('sends supported MCP servers when creating a session', async () => {
  const status = await runtime.status();
  assert.equal(status.ready, true);
  const servers = JSON.parse(await readFile(marker, 'utf8')) as Array<{ name: string }>;
  assert.deepEqual(servers.map((server) => server.name), ['stdio', 'http']);
});
