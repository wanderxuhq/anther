import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentRuntime } from './agent.ts';
import type { DiscoveredAgent } from './agent-profiles.ts';
import { FileStore } from './files.ts';
import { MAX_SYSTEM_PROMPT, normalizeSystemPrompt } from './system-prompt.ts';

const fakeAgent = String.raw`
const readline = require('node:readline');
const fs = require('node:fs');
const statePath = process.argv[2];
const supported = process.argv[3] !== 'nosupport';
let counter = 0;
let sessions = [];
let calls = [];
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const save = () => fs.writeFileSync(statePath, JSON.stringify({ sessions, calls }), 'utf8');
const nextId = () => 'sess_prompt_' + (++counter);
const record = (method, sessionId, params) => calls.push({
  method,
  sessionId,
  systemPrompt: params && params.systemPrompt !== undefined ? params.systemPrompt : null,
});
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, delete: {}, ...(supported ? { systemPrompt: {} } : {}) },
        },
        agentInfo: { name: 'Prompt Fake', version: '1' },
      });
      break;
    case 'session/new': {
      const sessionId = nextId();
      sessions.push({ sessionId, title: 'New chat', updatedAt: new Date().toISOString() });
      record('new', sessionId, message.params);
      save();
      respond(message.id, { sessionId, configOptions: [] });
      break;
    }
    case 'session/load':
      record('load', message.params.sessionId, message.params);
      save();
      respond(message.id, { configOptions: [] });
      break;
    case 'session/fork': {
      const sessionId = nextId();
      sessions.push({ sessionId, title: 'New chat', updatedAt: new Date().toISOString() });
      record('fork', sessionId, message.params);
      save();
      respond(message.id, { sessionId, configOptions: [] });
      break;
    }
    case 'session/delete':
      sessions = sessions.filter((session) => session.sessionId !== message.params.sessionId);
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
  systemPrompt: unknown;
};

type FakeState = {
  sessions: Array<{ sessionId: string }>;
  calls: FakeCall[];
};

let root: string;
let runtime!: AgentRuntime;
let statePath: string;
let prompt: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-prompt-'));
  statePath = path.join(root, 'state.json');
  prompt = undefined;
});

afterEach(async () => {
  await runtime?.close();
  await rm(root, { recursive: true, force: true });
});

async function start(options: { supported?: boolean } = {}): Promise<AgentRuntime> {
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const args = [script, statePath];
  if (options.supported === false) args.push('nosupport');
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-prompt', name: 'Fake Prompt', command: process.execPath, args },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root), () => [], () => prompt);
  return runtime;
}

async function readState(): Promise<FakeState> {
  try {
    return JSON.parse(await readFile(statePath, 'utf8')) as FakeState;
  } catch {
    return { sessions: [], calls: [] };
  }
}

const expectedPrompt = (text: string) => ({
  mode: 'append',
  content: [{ type: 'text', text }],
});

test('normalizes system prompt text', () => {
  assert.equal(normalizeSystemPrompt('  Be concise.  '), 'Be concise.');
  assert.equal(normalizeSystemPrompt('   '), undefined);
  assert.equal(normalizeSystemPrompt(null), undefined);
  assert.throws(() => normalizeSystemPrompt(1), /must be a string/);
  assert.throws(() => normalizeSystemPrompt('x'.repeat(MAX_SYSTEM_PROMPT + 1)), /at most/);
  assert.throws(() => normalizeSystemPrompt('a\0b'), /NUL/);
});

test('sends the system prompt when creating a bootstrap session', async () => {
  prompt = 'Be concise.';
  await start();
  const status = await runtime.status();
  assert.equal(status.ready, true);
  const state = await readState();
  const created = state.calls.find((call) => call.method === 'new');
  assert.deepEqual(created?.systemPrompt, expectedPrompt('Be concise.'));
});

test('uses the new prompt after bootstrap invalidation', async () => {
  prompt = 'First rule.';
  await start();
  const first = await runtime.status();
  assert.ok(first.bootstrapSessionID);

  prompt = 'Second rule.';
  runtime.invalidateBootstrap();
  const second = await runtime.status();
  assert.ok(second.bootstrapSessionID);
  assert.notEqual(second.bootstrapSessionID, first.bootstrapSessionID);

  const state = await readState();
  const created = state.calls.find((call) => call.method === 'new' && call.sessionId === second.bootstrapSessionID);
  assert.deepEqual(created?.systemPrompt, expectedPrompt('Second rule.'));
});

test('keeps each session prompt snapshot for load and fork', async () => {
  prompt = 'First rule.';
  await start();
  const boot = await runtime.createSession();
  prompt = 'Second rule.';
  const second = await runtime.createSession();
  const forked = await runtime.fork(second.id);
  await runtime.messages(boot.id);
  await runtime.messages(second.id);

  const state = await readState();
  const firstLoad = state.calls.find((call) => call.method === 'load' && call.sessionId === boot.id);
  assert.deepEqual(firstLoad?.systemPrompt, expectedPrompt('First rule.'));
  const secondLoad = state.calls.find((call) => call.method === 'load' && call.sessionId === second.id);
  assert.deepEqual(secondLoad?.systemPrompt, expectedPrompt('Second rule.'));
  const forkCall = state.calls.find((call) => call.method === 'fork' && call.sessionId === forked.id);
  assert.deepEqual(forkCall?.systemPrompt, expectedPrompt('Second rule.'));
});

test('does not retroactively apply a prompt to sessions created without one', async () => {
  await start();
  const boot = await runtime.createSession();
  prompt = 'Later rule.';
  await runtime.messages(boot.id);
  const state = await readState();
  const load = state.calls.find((call) => call.method === 'load' && call.sessionId === boot.id);
  assert.equal(load?.systemPrompt, null);
});

test('does not send a system prompt when the agent does not advertise it', async () => {
  prompt = 'Ignored rule.';
  await start({ supported: false });
  await runtime.status();
  await runtime.createSession();
  const state = await readState();
  assert.ok(state.calls.length > 0);
  assert.ok(state.calls.every((call) => call.systemPrompt === null));
});
