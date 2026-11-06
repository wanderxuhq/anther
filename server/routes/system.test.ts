// server/routes/system.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpServer } from '../http.ts';
import { registerSystemRoutes } from './system.ts';

test('GET /api/system：返回服务器系统信息', async () => {
  const server = new HttpServer({ staticDir: '' });
  registerSystemRoutes(server, process.cwd());
  await server.listen(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const res = await fetch(`${base}/api/system`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(typeof body.hostname, 'string');
    assert.equal(typeof body.platform, 'string');
    assert.equal(typeof body.node, 'string');
    assert.equal(typeof body.workspace, 'string');
    assert.ok((body.totalMem as number) > 0);
    assert.ok((body.cpuCount as number) >= 1);
    assert.ok(Array.isArray(body.loadavg));
  } finally {
    await server.close();
  }
});
