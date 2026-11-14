import { test, before, after } from 'node:test';
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
let nextId = 100;
const pending = new Map();
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const request = (method, params) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  send({ jsonrpc: '2.0', id, method, params });
});
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
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
      fs.writeFileSync(statePath + '.capabilities', JSON.stringify(message.params.clientCapabilities.elicitation || null), 'utf8');
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
        agentInfo: { name: 'Elicitation Fake', version: '1' },
      });
      break;
    case 'session/new':
      respond(message.id, { sessionId: 'sess_elicit', configOptions: [] });
      break;
    case 'session/prompt': {
      const response = await request('elicitation/create', {
        sessionId: 'sess_elicit',
        mode: 'url',
        elicitationId: 'url_1',
        url: 'https://example.com/oauth?state=abc',
        message: 'Authorize the fake app',
      });
      fs.writeFileSync(statePath, JSON.stringify(response), 'utf8');
      respond(message.id, { stopReason: 'end_turn' });
      break;
    }
    case 'session/load':
      respond(message.id, { configOptions: [] });
      break;
    case 'session/list':
      respond(message.id, { sessions: [] });
      break;
    case 'session/cancel':
      break;
    default:
      if (message.id !== undefined) fail(message.id, -32601, 'Method not found');
  }
});
`;

let root: string;
let runtime: AgentRuntime;
let statePath: string;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-elicit-'));
  statePath = path.join(root, 'state.json');
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-elicit', name: 'Fake Elicit', command: process.execPath, args: [script, statePath] },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root));
  await runtime.status();
});

after(async () => {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
});

test('advertises URL elicitation and accepts the consent response', async () => {
  const capabilities = JSON.parse(await readFile(`${statePath}.capabilities`, 'utf8')) as { url?: unknown };
  assert.deepEqual(capabilities.url, {});

  const session = await runtime.createSession();
  const form = await new Promise<import('./agent-forms.ts').AgentForm>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('timed out waiting for URL elicitation'));
    }, 5000);
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type !== 'form') return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(event.form);
    });
    void runtime.prompt(session.id, [{ type: 'text', text: 'connect' }]).catch(reject);
  });

  assert.equal(form.mode, 'url');
  assert.equal(form.sessionID, 'sess_elicit');
  assert.equal(form.url, 'https://example.com/oauth?state=abc');
  assert.equal(form.elicitationID, 'url_1');
  assert.equal(form.title, 'Authorize the fake app');
  assert.deepEqual(form.fields, []);

  await runtime.replyForm(form.id, 'accept');
  const response = await waitForState();
  assert.equal(response.action, 'accept');
  assert.equal(response.content, undefined);
});

async function waitForState(): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error('timed out waiting for the elicitation response');
}
