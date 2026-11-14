import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentRuntime } from './agent.ts';
import type { DiscoveredAgent } from './agent-profiles.ts';
import { FileStore } from './files.ts';

const fakeAgent = String.raw`
const readline = require('node:readline');
const mode = process.argv[2];
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
        agentInfo: { name: 'User Message Fake', version: '1' },
      });
      break;
    case 'session/new':
      respond(message.id, { sessionId: 'sess_user', configOptions: [] });
      break;
    case 'session/load':
      respond(message.id, { configOptions: [] });
      break;
    case 'session/list':
      respond(message.id, { sessions: [] });
      break;
    case 'session/prompt': {
      const text = message.params.prompt[0]?.text ?? '';
      if (mode === 'echo') {
        notify('session/update', {
          sessionId: 'sess_user',
          update: { sessionUpdate: 'user_message_chunk', messageId: 'echo-1', content: { type: 'text', text: 'echo ' } },
        });
        notify('session/update', {
          sessionId: 'sess_user',
          update: { sessionUpdate: 'user_message_chunk', messageId: 'echo-1', content: { type: 'text', text: 'me' } },
        });
      }
      notify('session/update', {
        sessionId: 'sess_user',
        update: { sessionUpdate: 'agent_message_chunk', messageId: 'answer-1', content: { type: 'text', text: 'done' } },
      });
      respond(message.id, { stopReason: 'end_turn' });
      break;
    }
    case 'session/cancel':
      break;
    default:
      if (message.id !== undefined) fail(message.id, -32601, 'Method not found');
  }
});
`;

let root: string;
let runtime: AgentRuntime;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-user-message-'));
});

afterEach(async () => {
  await runtime?.close();
  await rm(root, { recursive: true, force: true });
});

async function start(mode: 'noecho' | 'echo'): Promise<AgentRuntime> {
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-user-message', name: 'Fake User Message', command: process.execPath, args: [script, mode] },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root));
  return runtime;
}

async function promptAndWait(sessionID: string, text: string): Promise<void> {
  const done = new Promise<void>((resolve) => {
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === 'prompt_done' && event.sessionID === sessionID) {
        unsubscribe();
        resolve();
      }
    });
  });
  await runtime.prompt(sessionID, [{ type: 'text', text }]);
  await done;
}

test('keeps the user message in server history when the agent never echoes it', async () => {
  await start('noecho');
  await runtime.status();
  const session = await runtime.createSession();
  await promptAndWait(session.id, 'hello');

  const state = await runtime.messages(session.id);
  const users = state.updates.filter((update) => update.sessionUpdate === 'user_message_chunk');
  assert.equal(users.length, 1);
  assert.equal(users[0].sessionUpdate === 'user_message_chunk' ? users[0].content.type : '', 'text');
  assert.equal(users[0].sessionUpdate === 'user_message_chunk' && users[0].content.type === 'text'
    ? users[0].content.text
    : '', 'hello');
});

test('suppresses a live user echo instead of duplicating the message', async () => {
  await start('echo');
  await runtime.status();
  const session = await runtime.createSession();
  await promptAndWait(session.id, 'echo me');

  const state = await runtime.messages(session.id);
  const users = state.updates.filter((update) => update.sessionUpdate === 'user_message_chunk');
  assert.equal(users.length, 1);
  assert.equal(users[0].sessionUpdate === 'user_message_chunk' && users[0].content.type === 'text'
    ? users[0].content.text
    : '', 'echo me');
});
