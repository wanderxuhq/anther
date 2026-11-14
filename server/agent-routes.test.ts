import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import type * as acp from '@agentclientprotocol/sdk';
import type { AcpAgent } from './agent.ts';
import { HttpError } from './http-error.ts';
import { Router } from './http.ts';
import { registerAgentRoutes } from './routes/agent.ts';

function stubAgent(initial: acp.McpServer[] = []): AcpAgent & { closed: string[] } {
  let servers = initial;
  let prompt: string | undefined;
  const closed: string[] = [];
  const agent = {
    mcpServers: () => servers,
    setMcpServers: (next: acp.McpServer[]) => {
      servers = next;
      return servers;
    },
    systemPrompt: () => prompt,
    setSystemPrompt: (text: string | undefined) => {
      prompt = text;
      return prompt;
    },
    closeSession: async (sessionID: string) => {
      closed.push(sessionID);
    },
    closed,
  };
  return agent as unknown as AcpAgent & { closed: string[] };
}

test('GET and PUT /mcp expose the browser wire shape', async () => {
  const router = new Router();
  registerAgentRoutes(router, stubAgent());
  const get = router.handler('GET', '/_/agent/api/mcp');
  const put = router.handler('PUT', '/_/agent/api/mcp');
  assert.ok(get);
  assert.ok(put);
  const request = {} as IncomingMessage;
  const query = new URLSearchParams();

  assert.deepEqual(await get(request, undefined, query), { data: [] });

  const saved = await put(request, {
    servers: [
      { name: 'files', command: 'files', args: ['--stdio'], env: [] },
      { type: 'http', name: 'web', url: 'https://example.com/mcp', headers: [] },
    ],
  }, query);
  assert.deepEqual(saved, {
    data: [
      { type: 'stdio', name: 'files', command: 'files', args: ['--stdio'], env: [] },
      { type: 'http', name: 'web', url: 'https://example.com/mcp', headers: [] },
    ],
  });
  assert.deepEqual(await get(request, undefined, query), saved);
});

test('PUT /mcp rejects malformed configs with 400', async () => {
  const router = new Router();
  registerAgentRoutes(router, stubAgent());
  const put = router.handler('PUT', '/_/agent/api/mcp');
  assert.ok(put);
  const request = {} as IncomingMessage;
  const query = new URLSearchParams();

  await assert.rejects(
    async () => { await put(request, { servers: [{ name: 'a', command: 'x' }, { name: 'a', command: 'y' }] }, query); },
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    async () => { await put(request, { servers: [{ type: 'http', name: 'a', url: 'file:///etc/passwd' }] }, query); },
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    async () => { await put(request, { servers: 'nope' }, query); },
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
});

test('POST /sessions/close closes the requested session', async () => {
  const router = new Router();
  const agent = stubAgent();
  registerAgentRoutes(router, agent);
  const close = router.handler('POST', '/_/agent/api/sessions/close');
  assert.ok(close);
  const request = {} as IncomingMessage;
  const query = new URLSearchParams();

  assert.deepEqual(await close(request, { sessionID: 'sess_1' }, query), {});
  assert.deepEqual(agent.closed, ['sess_1']);
  await assert.rejects(
    async () => { await close(request, {}, query); },
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
});

test('GET and PUT /system-prompt normalize and clear the prompt', async () => {
  const router = new Router();
  registerAgentRoutes(router, stubAgent());
  const get = router.handler('GET', '/_/agent/api/system-prompt');
  const put = router.handler('PUT', '/_/agent/api/system-prompt');
  assert.ok(get);
  assert.ok(put);
  const request = {} as IncomingMessage;
  const query = new URLSearchParams();

  assert.deepEqual(await get(request, undefined, query), { data: null });
  assert.deepEqual(await put(request, { text: '  Be concise.  ' }, query), { data: 'Be concise.' });
  assert.deepEqual(await get(request, undefined, query), { data: 'Be concise.' });
  assert.deepEqual(await put(request, { text: null }, query), { data: null });
  await assert.rejects(
    async () => { await put(request, { text: 42 }, query); },
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    async () => { await put(request, { text: 'x'.repeat(16_001) }, query); },
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
});
