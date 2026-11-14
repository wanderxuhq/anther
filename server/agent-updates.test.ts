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
const sessionId = 'sess_updates';
const configOptions = [{
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  type: 'select',
  currentValue: 'build',
  options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }],
}, {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: 'fake/model-a',
  options: [{ value: 'fake/model-a', name: 'Model A' }],
}];
const updatedConfigOptions = [...configOptions, {
  id: 'thought_level',
  name: 'Thought level',
  category: 'thought_level',
  type: 'select',
  currentValue: 'high',
  options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
}].map((option) => option.id === 'mode' ? { ...option, currentValue: 'plan' } : option);
const modes = { currentModeId: 'build', availableModes: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }] };
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
const update = (value) => notify('session/update', { sessionId, update: value });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
        agentInfo: { name: 'Updates Fake', version: '1' },
      });
      break;
    case 'session/new':
    case 'session/load':
      respond(message.id, { sessionId, configOptions, modes });
      break;
    case 'session/list':
      respond(message.id, { sessions: [] });
      break;
    case 'session/prompt':
      update({ sessionUpdate: 'config_option_update', configOptions: updatedConfigOptions });
      update({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
      respond(message.id, { stopReason: 'end_turn' });
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

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-updates-'));
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-updates', name: 'Fake Updates', command: process.execPath, args: [script] },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root));
});

afterEach(async () => {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
});

test('caches mode and config updates from the agent', async () => {
  const status = await runtime.status();
  assert.equal(status.ready, true);
  const session = await runtime.createSession();
  const seen = new Set<string>();
  const done = new Promise<void>((resolve) => {
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type !== 'update' || event.sessionID !== session.id) return;
      if (event.update.sessionUpdate === 'config_option_update' || event.update.sessionUpdate === 'current_mode_update') {
        seen.add(event.update.sessionUpdate);
      }
      if (seen.has('config_option_update') && seen.has('current_mode_update')) {
        unsubscribe();
        resolve();
      }
    });
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out waiting for ACP state updates')), 5000);
  });
  try {
    await runtime.prompt(session.id, 'update yourself');
    await Promise.race([done, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  const state = await runtime.messages(session.id);
  const thought = state.configOptions.find((option) => option.id === 'thought_level');
  assert.equal(thought?.type, 'select');
  if (thought?.type === 'select') assert.equal(thought.currentValue, 'high');
  assert.equal(state.modes?.currentModeId, 'plan');
});
