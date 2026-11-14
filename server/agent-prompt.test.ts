import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import { AgentRuntime } from './agent.ts';
import type { DiscoveredAgent } from './agent-profiles.ts';
import { FileStore } from './files.ts';

const fakeAgent = String.raw`
const readline = require('node:readline');
const fs = require('node:fs/promises');
const marker = process.argv[2];
const sessionId = 'sess_prompt';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
        agentInfo: { name: 'Prompt Fake', version: '1' },
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
      await fs.writeFile(marker, JSON.stringify(message.params.prompt), 'utf8');
      respond(message.id, { stopReason: 'end_turn' });
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
  root = await mkdtemp(path.join(tmpdir(), 'anther-agent-prompt-'));
  marker = path.join(root, 'prompt.json');
  const script = path.join(root, 'fake-agent.cjs');
  await writeFile(script, fakeAgent);
  const discovered: DiscoveredAgent = {
    profile: { id: 'fake-prompt', name: 'Fake Prompt', command: process.execPath, args: [script, marker] },
    executable: process.execPath,
  };
  runtime = new AgentRuntime(root, discovered, new FileStore(root));
});

afterEach(async () => {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
});

async function promptAndRead(sessionID: string, content: ContentBlock[]): Promise<unknown> {
  const done = new Promise<void>((resolve) => {
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === 'prompt_done' && event.sessionID === sessionID) {
        unsubscribe();
        resolve();
      }
    });
  });
  await runtime.prompt(sessionID, content);
  await done;
  return JSON.parse(await readFile(marker, 'utf8'));
}

test('passes text prompts through unchanged', async () => {
  const status = await runtime.status();
  assert.equal(status.ready, true);
  const session = await runtime.createSession();
  const content: ContentBlock[] = [{ type: 'text', text: 'hello' }];
  assert.deepEqual(await promptAndRead(session.id, content), content);
});

test('passes image, audio, resource and resource-link blocks through', async () => {
  const status = await runtime.status();
  assert.equal(status.ready, true);
  const session = await runtime.createSession();
  const content: ContentBlock[] = [
    { type: 'text', text: 'inspect these' },
    { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
    { type: 'audio', mimeType: 'audio/wav', data: 'UklGRg==' },
    { type: 'resource_link', uri: 'file:///tmp/a.md', name: 'a.md', mimeType: 'text/markdown', size: 2 },
    { type: 'resource', resource: { uri: 'file:///tmp/b.txt', mimeType: 'text/plain', text: 'b' } },
  ];
  assert.deepEqual(await promptAndRead(session.id, content), content);
});
