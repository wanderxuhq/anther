import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentRuntime, type AgentPermission } from './agent.ts';
import type { DiscoveredAgent } from './agent-profiles.ts';
import { FileStore } from './files.ts';

const fakeAgent = String.raw`
const readline = require('node:readline');
const marker = process.argv[2];
const sessionId = 'sess_permission';
let nextId = 1000;
const pending = new Map();
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const request = (method, params) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  send({ jsonrpc: '2.0', id, method, params });
});
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
    return;
  }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
        agentInfo: { name: 'Permission Fake', version: '1' },
      });
      break;
    case 'session/new':
      respond(message.id, { sessionId, configOptions: [] });
      break;
    case 'session/load':
      respond(message.id, { configOptions: [] });
      break;
    case 'session/list':
      respond(message.id, { sessions: [] });
      break;
    case 'session/prompt':
      request('session/request_permission', {
        sessionId,
        toolCall: {
          toolCallId: 'call_permission',
          title: 'Allow this action?',
          kind: 'switch_mode',
          status: 'pending',
          content: [{ type: 'content', content: { type: 'text', text: 'Need permission' } }],
        },
        options: [
          { optionId: 'once-opt', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'always-opt', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'reject-opt', name: 'Reject', kind: 'reject_once' },
        ],
      }).then(async (response) => {
        await require('node:fs/promises').writeFile(marker, response.outcome.optionId, 'utf8');
        respond(message.id, { stopReason: 'end_turn' });
      }).catch((error) => fail(message.id, -32603, String(error)));
      break;
    default:
      if (message.id !== undefined) fail(message.id, -32601, 'Method not found');
  }
});
`;

let root: string;
let marker: string;
let runtime: AgentRuntime;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-permission-'));
  marker = path.join(root, 'selected-option.txt');
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-permission', name: 'Fake Permission', command: process.execPath, args: [script, marker] },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root));
});

afterEach(async () => {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
});

test('replies with the selected ACP permission option id', async () => {
  const status = await runtime.status();
  assert.equal(status.ready, true);
  const session = await runtime.createSession();

  let permission: AgentPermission | undefined;
  const seen = new Promise<AgentPermission>((resolve) => {
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === 'permission') {
        unsubscribe();
        permission = event.request;
        resolve(event.request);
      }
    });
  });
  const done = new Promise<void>((resolve) => {
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === 'prompt_done' && event.sessionID === session.id) {
        unsubscribe();
        resolve();
      }
    });
  });

  await runtime.prompt(session.id, 'ask for permission');
  const request = await seen;
  assert.ok(permission);
  await assert.rejects(runtime.replyPermission(request.id, 'missing-opt'), /Unknown permission option/);
  await runtime.replyPermission(request.id, 'always-opt');
  await done;

  assert.equal(await readFile(marker, 'utf8'), 'always-opt');
});
