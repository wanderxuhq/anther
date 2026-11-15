import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentRuntime } from './agent.ts';
import type { DiscoveredAgent } from './agent-profiles.ts';
import { FileStore } from './files.ts';

const fakeAgent = String.raw`
const readline = require('node:readline');
let nextId = 1000;
const pending = new Map();
const marker = process.argv[2];
const sessionId = 'sess_exit';
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
        agentInfo: { name: 'Exit Fake', version: '1' },
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
      request('terminal/create', {
        sessionId,
        command: process.execPath,
        args: ['-e', 'setTimeout(() => require("fs").writeFileSync(' + JSON.stringify(marker) + ', "late"), 500); setInterval(() => {}, 1000)'],
      }).then(() => process.exit(0)).catch(() => process.exit(1));
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
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-term-exit-'));
  marker = path.join(root, 'late-marker.txt');
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: {
      id: 'fake-exit',
      name: 'Fake Exit',
      command: process.execPath,
      args: [script, marker],
    },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root));
});

afterEach(async () => {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
});

test('kills ACP terminals when the agent process exits unexpectedly', async () => {
  const status = await runtime.status();
  assert.equal(status.ready, true);
  const session = await runtime.createSession();
  let off: (() => void) | undefined;
  const exited = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off?.();
      reject(new Error('terminal exit was not observed'));
    }, 5_000);
    off = runtime.subscribe((event) => {
      if (event.type !== 'terminal_output' || !event.exitStatus) return;
      clearTimeout(timer);
      off?.();
      resolve();
    });
  });
  await runtime.prompt(session.id, [{ type: 'text', text: 'start the terminal then exit' }]);
  await exited;
  await assert.rejects(access(marker), { code: 'ENOENT' });
});
