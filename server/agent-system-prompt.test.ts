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
const failFirstLoad = process.argv[4] === 'failfirst';
const rejectPrompt = process.argv[5] === 'rejectprompt';
let loadFailures = 0;
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
      if (rejectPrompt && message.params.systemPrompt) {
        fail(message.id, -32602, 'prompt rejected');
        break;
      }
      const sessionId = nextId();
      sessions.push({ sessionId, title: 'New chat', updatedAt: new Date().toISOString() });
      record('new', sessionId, message.params);
      save();
      respond(message.id, { sessionId, configOptions: [] });
      break;
    }
    case 'session/load':
      if (failFirstLoad && message.params.systemPrompt && loadFailures === 0) {
        loadFailures += 1;
        fail(message.id, -32602, 'bad prompt');
        break;
      }
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

async function start(options: { supported?: boolean; failFirstLoad?: boolean; rejectPrompt?: boolean } = {}): Promise<AgentRuntime> {
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const args = [
    script,
    statePath,
    options.supported === false ? 'nosupport' : 'support',
    options.failFirstLoad ? 'failfirst' : 'ok',
  ];
  if (options.rejectPrompt) args.push('rejectprompt');
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

test('uses the current prompt for unattached loads and captures new/fork requests', async () => {
  prompt = 'First rule.';
  await start();
  const boot = await runtime.createSession();
  prompt = 'Second rule.';
  const second = await runtime.createSession();
  const forked = await runtime.fork(second.id);
  prompt = 'Third rule.';
  await runtime.messages(forked.id);
  await runtime.messages('sess_existing');
  await runtime.messages(boot.id);

  const state = await readState();
  assert.equal(state.calls.some((call) => call.method === 'load' && call.sessionId === boot.id), false);
  const existingLoad = state.calls.find((call) => call.method === 'load' && call.sessionId === 'sess_existing');
  assert.deepEqual(existingLoad?.systemPrompt, expectedPrompt('Third rule.'));
  const forkCall = state.calls.find((call) => call.method === 'fork' && call.sessionId === forked.id);
  assert.deepEqual(forkCall?.systemPrompt, expectedPrompt('Second rule.'));
  const forkLoad = state.calls.find((call) => call.method === 'load' && call.sessionId === forked.id);
  assert.deepEqual(forkLoad?.systemPrompt, expectedPrompt('Second rule.'));
});

test('does not attach or send a prompt for sessions created without one', async () => {
  await start();
  const boot = await runtime.createSession();
  prompt = 'Later rule.';
  await runtime.messages(boot.id);
  const state = await readState();
  assert.equal(state.calls.some((call) => call.method === 'load' && call.sessionId === boot.id), false);
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

test('retries with the current prompt after a rejected load', async () => {
  prompt = 'First rule.';
  await start({ failFirstLoad: true });
  await assert.rejects(runtime.messages('sess_existing'), /bad prompt/);
  prompt = 'Second rule.';
  await runtime.messages('sess_existing');
  const state = await readState();
  const load = state.calls.find((call) => call.method === 'load' && call.sessionId === 'sess_existing');
  assert.deepEqual(load?.systemPrompt, expectedPrompt('Second rule.'));
});

test('recovers when the agent rejects the stored prompt', async () => {
  prompt = 'Bad rule.';
  await start({ rejectPrompt: true });
  const failed = await runtime.status();
  assert.equal(failed.ready, false);

  prompt = undefined;
  const recovered = await runtime.status();
  assert.equal(recovered.ready, true);
  assert.ok(recovered.bootstrapSessionID);
  const state = await readState();
  assert.ok(state.calls.every((call) => call.systemPrompt === null));
});
