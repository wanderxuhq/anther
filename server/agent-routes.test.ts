import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import type * as acp from '@agentclientprotocol/sdk';
import type { AcpAgent } from './agent.ts';
import { HttpError } from './http-error.ts';
import { Router } from './http.ts';
import { registerAgentRoutes } from './routes/agent.ts';

function stubAgent(initial: acp.McpServer[] = []): AcpAgent {
  let servers = initial;
  return {
    mcpServers: () => servers,
    setMcpServers: (next: acp.McpServer[]) => {
      servers = next;
      return servers;
    },
  } as unknown as AcpAgent;
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
