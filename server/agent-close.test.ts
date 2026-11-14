import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentRuntime } from './agent.ts';
import type { DiscoveredAgent } from './agent-profiles.ts';
import { FileStore } from './files.ts';

const fakeAgent = String.raw`
const readline = require('node:readline');
const fs = require('node:fs');
const statePath = process.argv[2];
const closeMissing = process.argv[3] === 'notfound';
let counter = 0;
let sessions = [];
let calls = [];
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const save = () => fs.writeFileSync(statePath, JSON.stringify({ sessions, calls }), 'utf8');
const nextId = () => 'sess_close_' + (++counter);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, close: {} },
        },
        agentInfo: { name: 'Close Fake', version: '1' },
      });
      break;
    case 'session/new': {
      const sessionId = nextId();
      sessions.push({ sessionId, title: 'New chat', updatedAt: new Date().toISOString() });
      calls.push({ method: 'new', sessionId });
      save();
      respond(message.id, { sessionId, configOptions: [] });
      break;
    }
    case 'session/close':
      calls.push({ method: 'close', sessionId: message.params.sessionId });
      save();
      if (closeMissing) fail(message.id, -32002, 'session not found');
      else respond(message.id, {});
      break;
    case 'session/load':
      calls.push({ method: 'load', sessionId: message.params.sessionId });
      save();
      notify('session/update', {
        sessionId: message.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', messageId: 'msg', content: { type: 'text', text: 'replayed' } },
      });
      setTimeout(() => respond(message.id, { configOptions: [] }), 25);
      break;
    case 'session/list':
      respond(message.id, { sessions });
      break;
    case 'session/delete':
      sessions = sessions.filter((session) => session.sessionId !== message.params.sessionId);
      save();
      respond(message.id, {});
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

type FakeCall = { method: string; sessionId: string };
type FakeState = { sessions: Array<{ sessionId: string }>; calls: FakeCall[] };

let root: string;
let runtime: AgentRuntime;
let statePath: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-close-'));
  statePath = path.join(root, 'state.json');
});

afterEach(async () => {
  await runtime?.close();
  await rm(root, { recursive: true, force: true });
});

async function start(options: { notFound?: boolean } = {}): Promise<AgentRuntime> {
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const args = [script, statePath];
  if (options.notFound) args.push('notfound');
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-close', name: 'Fake Close', command: process.execPath, args },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root));
  return runtime;
}

async function readState(): Promise<FakeState> {
  try {
    return JSON.parse(await readFile(statePath, 'utf8')) as FakeState;
  } catch {
    return { sessions: [], calls: [] };
  }
}

test('closes a session, keeps it listed, and reloads it on reopen', async () => {
  await start();
  await runtime.status();
  const session = await runtime.createSession();
  const first = await runtime.messages(session.id);
  assert.deepEqual(first.updates, []);
  let state = await readState();
  assert.equal(state.calls.filter((call) => call.method === 'load').length, 0);
  await runtime.messages(session.id);
  state = await readState();
  assert.equal(state.calls.filter((call) => call.method === 'load').length, 0);

  await runtime.closeSession(session.id);
  state = await readState();
  assert.ok(state.calls.some((call) => call.method === 'close' && call.sessionId === session.id));
  assert.ok(state.sessions.some((item) => item.sessionId === session.id));

  const reopened = await runtime.messages(session.id);
  assert.equal(reopened.updates.length, 1);
  state = await readState();
  assert.equal(state.calls.filter((call) => call.method === 'load' && call.sessionId === session.id).length, 1);

  const listed = await runtime.listSessions();
  assert.ok(listed.some((item) => item.id === session.id));
});

test('treats closing a missing session as success', async () => {
  await start({ notFound: true });
  await runtime.status();
  const session = await runtime.createSession();
  await runtime.messages(session.id);
  await runtime.closeSession(session.id);
  const state = await readState();
  assert.ok(state.calls.some((call) => call.method === 'close' && call.sessionId === session.id));
});
