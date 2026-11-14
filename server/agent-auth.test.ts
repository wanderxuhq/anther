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
let authenticated = false;
const sessionId = 'sess_auth';
const authMethods = [
  { id: 'login', name: 'Login' },
  { id: 'terminal-login', name: 'Terminal login', type: 'terminal', args: ['--login'] },
];
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const requireAuth = (id) => {
  if (authenticated) return false;
  fail(id, -32000, 'Authentication required');
  return true;
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          auth: { logout: {} },
          sessionCapabilities: { list: {} },
        },
        authMethods,
        agentInfo: { name: 'Auth Fake', version: '1' },
      });
      break;
    case 'authenticate':
      if (message.params?.methodId === 'login') {
        authenticated = true;
        respond(message.id, {});
      } else {
        fail(message.id, -32602, 'Unknown auth method');
      }
      break;
    case 'logout':
      authenticated = false;
      respond(message.id, {});
      break;
    case 'session/new':
      if (!requireAuth(message.id)) respond(message.id, { sessionId, configOptions: [] });
      break;
    case 'session/load':
      if (!requireAuth(message.id)) respond(message.id, { configOptions: [] });
      break;
    case 'session/list':
      if (!requireAuth(message.id)) respond(message.id, { sessions: [] });
      break;
    case 'session/prompt':
      if (!requireAuth(message.id)) respond(message.id, { stopReason: 'end_turn' });
      break;
    default:
      if (message.id !== undefined) fail(message.id, -32601, 'Method not found');
  }
});
`;

let root: string;
let runtime: AgentRuntime;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-auth-'));
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake', name: 'Fake', command: process.execPath, args: [script] },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root));
});

afterEach(async () => {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
});

test('reports auth methods while bootstrap is auth-gated', async () => {
  const status = await runtime.status();
  assert.equal(status.ready, true);
  assert.equal(status.authRequired, true);
  assert.equal(status.authenticated, false);
  assert.deepEqual(status.authMethods?.map((method) => method.id), ['login', 'terminal-login']);
});

test('authenticates an agent method and logs out', async () => {
  await runtime.status();
  await runtime.authenticate('login');
  const authenticated = await runtime.status();
  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.authRequired, false);

  const created = await runtime.createSession();
  assert.equal(created.id, 'sess_auth');

  await runtime.logout();
  const loggedOut = await runtime.status();
  assert.equal(loggedOut.authenticated, false);
  assert.equal(loggedOut.authRequired, true);
});

test('rejects unknown and terminal auth methods', async () => {
  await runtime.status();
  await assert.rejects(runtime.authenticate('missing'), /Unknown auth method/);
  await assert.rejects(runtime.authenticate('terminal-login'), /terminal authentication/i);
});
