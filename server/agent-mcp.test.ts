import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import { AgentRuntime } from './agent.ts';
import type { DiscoveredAgent } from './agent-profiles.ts';
import { FileStore } from './files.ts';
import {
  filterMcpServers,
  mcpServersEqual,
  normalizeMcpServers,
  wireMcpServers,
} from './mcp.ts';

const fakeAgent = String.raw`
const readline = require('node:readline');
const fs = require('node:fs');
const statePath = process.argv[2];
const delay = Number(process.argv[3] || 0);
const noDelete = process.argv[4] === 'nodelete';
let counter = 0;
let sessions = [];
let calls = [];
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const save = () => fs.writeFileSync(statePath, JSON.stringify({ sessions, calls }), 'utf8');
const nextId = () => 'sess_' + (++counter);
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true, sse: false },
          sessionCapabilities: { list: {}, ...(noDelete ? {} : { delete: {} }) },
        },
        agentInfo: { name: 'MCP Fake', version: '1' },
      });
      break;
    case 'session/new': {
      const sessionId = nextId();
      sessions.push({ sessionId, title: 'New chat', updatedAt: new Date().toISOString() });
      calls.push({ method: 'new', sessionId, mcpServers: message.params.mcpServers || [] });
      save();
      if (delay > 0) {
        fs.writeFileSync(statePath + '.started', sessionId, 'utf8');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      respond(message.id, { sessionId, configOptions: [] });
      break;
    }
    case 'session/load':
      calls.push({ method: 'load', sessionId: message.params.sessionId, mcpServers: message.params.mcpServers || [] });
      save();
      respond(message.id, { configOptions: [] });
      break;
    case 'session/fork': {
      const sessionId = nextId();
      sessions.push({ sessionId, title: 'New chat', updatedAt: new Date().toISOString() });
      calls.push({ method: 'fork', sessionId, parent: message.params.sessionId, mcpServers: message.params.mcpServers || [] });
      save();
      respond(message.id, { sessionId, configOptions: [] });
      break;
    }
    case 'session/delete':
      if (noDelete) {
        fail(message.id, -32601, 'Method not found');
        break;
      }
      sessions = sessions.filter((session) => session.sessionId !== message.params.sessionId);
      calls.push({ method: 'delete', sessionId: message.params.sessionId });
      save();
      respond(message.id, {});
      break;
    case 'session/list':
      respond(message.id, { sessions });
      break;
    case 'session/prompt':
      respond(message.id, { stopReason: 'end_turn' });
      break;
    case 'session/cancel':
      break;
    default:
      if (message.id !== undefined) fail(message.id, -32601, 'Method not found');
  }
});
`;

type FakeCall = {
  method: string;
  sessionId: string;
  mcpServers?: Array<{ name: string; type?: string }>;
  parent?: string;
};

type FakeState = {
  sessions: Array<{ sessionId: string; title?: string; updatedAt?: string }>;
  calls: FakeCall[];
};

let root: string;
let runtime!: AgentRuntime;
let statePath: string;
let mcp: acp.McpServer[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-mcp-'));
  statePath = path.join(root, 'state.json');
  mcp = [];
});

afterEach(async () => {
  await runtime?.close();
  await rm(root, { recursive: true, force: true });
});

async function start(options: { delay?: number; noDelete?: boolean } = {}): Promise<AgentRuntime> {
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const args = [script, statePath, String(options.delay ?? 0)];
  if (options.noDelete) args.push('nodelete');
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-mcp', name: 'Fake MCP', command: process.execPath, args },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root), () => mcp);
  return runtime;
}

async function readState(): Promise<FakeState> {
  try {
    return JSON.parse(await readFile(statePath, 'utf8')) as FakeState;
  } catch {
    return { sessions: [], calls: [] };
  }
}

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  label: string,
  timeout = 4000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test('normalizes, validates and maps MCP servers to the browser shape', () => {
  const internal = normalizeMcpServers([
    { type: 'stdio', name: 'files', command: 'files', args: ['--stdio'], env: [{ name: 'A', value: 'B' }] },
    { type: 'http', name: 'web', url: 'https://example.com/mcp', headers: [{ name: 'X', value: 'Y' }] },
    { type: 'sse', name: 'events', url: 'https://example.com/sse', headers: [] },
  ]);
  assert.deepEqual(wireMcpServers(internal), [
    { type: 'stdio', name: 'files', command: 'files', args: ['--stdio'], env: [{ name: 'A', value: 'B' }] },
    { type: 'http', name: 'web', url: 'https://example.com/mcp', headers: [{ name: 'X', value: 'Y' }] },
    { type: 'sse', name: 'events', url: 'https://example.com/sse', headers: [] },
  ]);
  const explicitStdio = {
    type: 'stdio',
    name: 'explicit',
    command: 'x',
    args: [],
    env: [],
  } as unknown as acp.McpServer;
  assert.deepEqual(filterMcpServers([explicitStdio], { http: false, sse: false }).map((server) => server.name), ['explicit']);
  assert.equal(
    mcpServersEqual(
      normalizeMcpServers([{ name: 'a', command: 'x' }]),
      normalizeMcpServers([{ name: 'a', command: 'x' }]),
    ),
    true,
  );
  assert.equal(
    mcpServersEqual(
      normalizeMcpServers([{ name: 'a', command: 'x' }]),
      normalizeMcpServers([{ name: 'a', command: 'y' }]),
    ),
    false,
  );
});

test('rejects malformed, duplicate and unsafe MCP configs', () => {
  assert.throws(() => normalizeMcpServers([{}]), /name is required/);
  assert.throws(() => normalizeMcpServers([{ name: 'a' }]), /command or url is required/);
  assert.throws(() => normalizeMcpServers([
    { name: 'a', command: 'x' },
    { name: 'a', command: 'y' },
  ]), /duplicate MCP server name/);
  assert.throws(() => normalizeMcpServers([
    { type: 'http', name: 'a', url: 'file:///etc/passwd' },
  ]), /url must use http or https/);
  assert.throws(() => normalizeMcpServers([
    { type: 'http', name: 'a', url: 'not a url' },
  ]), /valid URL/);
  assert.throws(() => normalizeMcpServers([
    { name: 'a', command: 'x', env: [{ name: 'A\nB', value: 'v' }] },
  ]), /control characters/);
  assert.throws(() => normalizeMcpServers([
    { type: 'http', name: 'a', url: 'https://x', headers: [{ name: 'X', value: 'v\r\nInjected: 1' }] },
  ]), /invalid headers value/);
  assert.throws(() => normalizeMcpServers([
    { type: 'http', name: 'a', url: 'https://x', headers: [{ name: 'X', value: '1' }, { name: 'x', value: '2' }] },
  ]), /duplicate headers name/);
  assert.throws(() => normalizeMcpServers([
    { name: 'a'.repeat(129), command: 'x' },
  ]), /name is too long/);
  assert.throws(() => normalizeMcpServers([
    { name: 'a', command: 'x', env: [{ name: 'A', value: 1 }] },
  ]), /env value must be a string/);
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

test('sends supported MCP servers when creating a session', async () => {
  mcp = normalizeMcpServers([
    { name: 'stdio', command: 'x' },
    { type: 'http', name: 'http', url: 'https://x' },
    { type: 'sse', name: 'sse', url: 'https://y' },
  ]);
  await start();
  const status = await runtime.status();
  assert.equal(status.ready, true);
  const state = await waitFor(async () => {
    const value = await readState();
    return value.calls.length > 0 ? value : undefined;
  }, 'bootstrap session');
  const created = state.calls.find((call) => call.method === 'new');
  assert.deepEqual(created?.mcpServers?.map((server) => server.name), ['stdio', 'http']);
});

test('deletes an invalidated bootstrap and hides it from the session list', async () => {
  await start();
  mcp = normalizeMcpServers([{ name: 'a', command: 'a' }]);
  const first = await runtime.status();
  assert.ok(first.bootstrapSessionID);

  mcp = normalizeMcpServers([{ name: 'b', command: 'b' }]);
  runtime.invalidateBootstrap();
  const second = await runtime.status();
  assert.ok(second.bootstrapSessionID);
  assert.notEqual(second.bootstrapSessionID, first.bootstrapSessionID);

  assert.deepEqual(await runtime.listSessions(), []);
  const state = await waitFor(async () => {
    const value = await readState();
    const deleted = value.calls.some((call) => call.method === 'delete' && call.sessionId === first.bootstrapSessionID);
    return deleted ? value : undefined;
  }, 'abandoned bootstrap deletion');
  assert.ok(state.sessions.some((session) => session.sessionId === second.bootstrapSessionID));
  assert.ok(!state.sessions.some((session) => session.sessionId === first.bootstrapSessionID));
  const created = state.calls.find((call) => call.method === 'new' && call.sessionId === second.bootstrapSessionID);
  assert.deepEqual(created?.mcpServers?.map((server) => server.name), ['b']);

  const session = await runtime.createSession();
  assert.equal(session.id, second.bootstrapSessionID);
});

test('serializes concurrent bootstrap creation and discards a stale result', async () => {
  await start({ delay: 200 });
  mcp = normalizeMcpServers([{ name: 'a', command: 'a' }]);
  const first = runtime.status();
  await waitFor(async () => {
    try {
      await readFile(`${statePath}.started`, 'utf8');
      return true;
    } catch {
      return undefined;
    }
  }, 'first bootstrap request');

  mcp = normalizeMcpServers([{ name: 'b', command: 'b' }]);
  runtime.invalidateBootstrap();
  const second = runtime.status();
  const [firstStatus, secondStatus] = await Promise.all([first, second]);
  assert.equal(firstStatus.ready, true);
  assert.equal(secondStatus.ready, true);
  assert.equal(firstStatus.bootstrapSessionID, secondStatus.bootstrapSessionID);
  assert.ok(secondStatus.bootstrapSessionID);

  const state = await waitFor(async () => {
    const value = await readState();
    const created = value.calls.filter((call) => call.method === 'new');
    const deleted = value.calls.some((call) => call.method === 'delete');
    return created.length === 2 && deleted ? value : undefined;
  }, 'stale bootstrap cleanup');
  const surviving = state.calls.find((call) => call.method === 'new' && call.sessionId === secondStatus.bootstrapSessionID);
  assert.deepEqual(surviving?.mcpServers?.map((server) => server.name), ['b']);
});

test('uses the current MCP set for unattached loads and captures new/fork requests', async () => {
  await start();
  mcp = normalizeMcpServers([{ name: 'a', command: 'a' }]);
  const boot = await runtime.createSession();
  mcp = normalizeMcpServers([{ name: 'b', command: 'b' }]);
  const second = await runtime.createSession();

  mcp = normalizeMcpServers([{ name: 'c', command: 'c' }]);
  await runtime.messages('sess_existing');
  await runtime.messages(boot.id);
  const forked = await runtime.fork(second.id);
  await runtime.messages(forked.id);

  const state = await readState();
  const loads = state.calls.filter((call) => call.method === 'load');
  assert.equal(loads.some((call) => call.sessionId === boot.id), false);
  const existingLoad = loads.find((call) => call.sessionId === 'sess_existing');
  assert.deepEqual(existingLoad?.mcpServers?.map((server) => server.name), ['c']);
  const forkCall = state.calls.find((call) => call.method === 'fork');
  assert.deepEqual(forkCall?.mcpServers?.map((server) => server.name), ['c']);
  const forkLoad = loads.find((call) => call.sessionId === forked.id);
  assert.deepEqual(forkLoad?.mcpServers?.map((server) => server.name), ['c']);
});

test('keeps retired bootstraps hidden when the agent cannot delete them', async () => {
  await start({ noDelete: true });
  mcp = normalizeMcpServers([{ name: 'a', command: 'a' }]);
  const first = await runtime.status();
  mcp = normalizeMcpServers([{ name: 'b', command: 'b' }]);
  runtime.invalidateBootstrap();
  const second = await runtime.status();

  assert.deepEqual(await runtime.listSessions(), []);
  const state = await readState();
  assert.ok(!state.calls.some((call) => call.method === 'delete'));
  assert.ok(state.sessions.some((session) => session.sessionId === first.bootstrapSessionID));
  assert.ok(state.sessions.some((session) => session.sessionId === second.bootstrapSessionID));
});
