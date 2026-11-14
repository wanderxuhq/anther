import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentRuntime } from './agent.ts';
import type { DiscoveredAgent } from './agent-profiles.ts';
import { FileStore } from './files.ts';
import { normalizeMcpServers } from './mcp.ts';

const fakeAgent = String.raw`
const readline = require('node:readline');
const fs = require('node:fs');
const statePath = process.argv[2];
const configOptions = [{
  id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fake/a',
  options: [{ value: 'fake/a', name: 'A' }],
}];
const modes = { currentModeId: 'build', availableModes: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }] };
let calls = [];
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const save = () => fs.writeFileSync(statePath, JSON.stringify(calls), 'utf8');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: false,
          sessionCapabilities: { list: {}, resume: {}, systemPrompt: {} },
        },
        agentInfo: { name: 'Resume Fake', version: '1' },
      });
      break;
    case 'session/new':
      calls.push({ method: 'new', systemPrompt: message.params.systemPrompt ?? null });
      save();
      respond(message.id, { sessionId: 'sess_new', configOptions, modes });
      break;
    case 'session/resume':
      calls.push({
        method: 'resume',
        sessionId: message.params.sessionId,
        cwd: message.params.cwd,
        systemPrompt: message.params.systemPrompt ?? null,
        mcpServers: message.params.mcpServers ?? [],
      });
      save();
      respond(message.id, { configOptions, modes });
      break;
    case 'session/list':
      respond(message.id, { sessions: [{ sessionId: 'sess_old', title: 'Old chat', updatedAt: new Date().toISOString() }] });
      break;
    case 'session/prompt':
      calls.push({ method: 'prompt', sessionId: message.params.sessionId });
      save();
      respond(message.id, { stopReason: 'end_turn' });
      break;
    case 'session/delete':
      respond(message.id, {});
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

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-resume-'));
  statePath = path.join(root, 'state.json');
});

afterEach(async () => {
  await runtime?.close();
  await rm(root, { recursive: true, force: true });
});

async function start(): Promise<AgentRuntime> {
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-resume', name: 'Fake Resume', command: process.execPath, args: [script, statePath] },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(
    root,
    discovered,
    new FileStore(root),
    () => normalizeMcpServers([{ name: 'files', command: 'files' }]),
    () => 'Be concise.',
  );
  return runtime;
}

test('resumes a session when the agent does not support load', async () => {
  await start();
  await runtime.status();
  const state = await runtime.messages('sess_old');
  assert.deepEqual(state.updates, []);
  assert.equal(state.configOptions.find((option) => option.id === 'model')?.currentValue, 'fake/a');
  assert.equal(state.modes?.currentModeId, 'build');

  const calls = JSON.parse(await readFile(statePath, 'utf8')) as Array<Record<string, unknown>>;
  const resumed = calls.find((call) => call.method === 'resume');
  assert.equal(resumed?.sessionId, 'sess_old');
  assert.equal(resumed?.cwd, root);
  assert.deepEqual(resumed?.systemPrompt, {
    mode: 'append',
    content: [{ type: 'text', text: 'Be concise.' }],
  });
  assert.deepEqual((resumed?.mcpServers as Array<{ name: string }>).map((server) => server.name), ['files']);

  await runtime.prompt('sess_old', [{ type: 'text', text: 'continue' }]);
  const after = JSON.parse(await readFile(statePath, 'utf8')) as Array<Record<string, unknown>>;
  assert.ok(after.some((call) => call.method === 'prompt' && call.sessionId === 'sess_old'));

  await runtime.messages('sess_old');
  const session = await runtime.createSession();
  await runtime.messages(session.id);
  const final = JSON.parse(await readFile(statePath, 'utf8')) as Array<Record<string, unknown>>;
  assert.equal(final.filter((call) => call.method === 'resume').length, 1);
});
