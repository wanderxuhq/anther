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
const sessionId = 'sess_config';
let configOptions = [{
  id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fake/a',
  options: [{ value: 'fake/a', name: 'A' }],
}, {
  id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'build',
  options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }],
}, {
  id: 'thought_level', name: 'Thought level', category: 'thought_level', type: 'select', currentValue: 'medium',
  options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }],
}, {
  id: 'brave_mode', name: 'Brave mode', type: 'boolean', currentValue: false,
}];
const modes = { currentModeId: 'build', availableModes: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }] };
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
        agentInfo: { name: 'Config Fake', version: '1' },
      });
      break;
    case 'session/new':
    case 'session/load':
      respond(message.id, { sessionId, configOptions, modes });
      break;
    case 'session/list':
      respond(message.id, { sessions: [] });
      break;
    case 'session/set_config_option': {
      const { configId, value, type } = message.params;
      if (configId === 'brave_mode') {
        if (type !== 'boolean' || typeof value !== 'boolean') {
          fail(message.id, -32602, 'boolean option requires type=boolean');
          return;
        }
        configOptions = configOptions.map((option) => option.id === configId ? { ...option, currentValue: value } : option);
        respond(message.id, { configOptions });
        return;
      }
      if (configId === 'thought_level' && typeof value === 'string') {
        configOptions = configOptions.map((option) => option.id === configId ? { ...option, currentValue: value } : option);
        respond(message.id, { configOptions });
        return;
      }
      fail(message.id, -32602, 'unknown config option');
      break;
    }
    case 'session/prompt':
      respond(message.id, { stopReason: 'end_turn' });
      break;
    default:
      if (message.id !== undefined) fail(message.id, -32601, 'Method not found');
  }
});
`;

let root: string;
let runtime: AgentRuntime;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-config-'));
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-config', name: 'Fake Config', command: process.execPath, args: [script] },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root));
});

afterEach(async () => {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
});

test('returns draft config options and updates boolean/select values', async () => {
  const status = await runtime.status();
  assert.equal(status.ready, true);
  assert.ok(status.bootstrapSessionID);
  assert.ok(status.configOptions?.some((option) => option.id === 'brave_mode' && option.type === 'boolean'));

  const boolean = await runtime.setConfig(status.bootstrapSessionID!, 'brave_mode', true);
  const brave = boolean.find((option) => option.id === 'brave_mode');
  assert.equal(brave?.type === 'boolean' ? brave.currentValue : undefined, true);

  const select = await runtime.setConfig(status.bootstrapSessionID!, 'thought_level', 'high');
  const thought = select.find((option) => option.id === 'thought_level');
  assert.equal(thought?.type === 'select' ? thought.currentValue : undefined, 'high');

  const after = await runtime.status();
  const braveAfter = after.configOptions?.find((option) => option.id === 'brave_mode');
  assert.equal(braveAfter?.type === 'boolean' ? braveAfter.currentValue : undefined, true);

  await runtime.createSession();
  const consumed = await runtime.status();
  assert.equal(consumed.bootstrapSessionID, undefined);
});
