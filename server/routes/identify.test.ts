// server/routes/identify.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { HttpServer } from '../http.ts';
import { IDENTIFY_PATH, registerIdentifyRoutes } from './identify.ts';

test('GET /api/anther：返回 anther 专属身份与实例上下文', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  const server = new HttpServer({ staticDir: '' });
  registerIdentifyRoutes(server, process.cwd());
  await server.listen(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const res = await fetch(base + IDENTIFY_PATH);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.name, 'anther');
    assert.equal(body.package, '@wanderxuhq/anther');
    assert.equal(body.version, pkg.version);
    assert.equal(body.apiVersion, 1);
    assert.equal(body.workspace, await realpath(process.cwd()));
    assert.match(String(body.instanceId), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.ok(typeof body.startedAt === 'number' && body.startedAt <= Date.now());
    // 识别接口不泄露主机/硬件等系统细节
    assert.equal('hostname' in body, false);
    assert.equal('totalMem' in body, false);
  } finally {
    await server.close();
  }
});

test('GET /api/identify：通用路径不再注册（避免与其他服务混淆）', async () => {
  const server = new HttpServer({ staticDir: '' });
  registerIdentifyRoutes(server, process.cwd());
  await server.listen(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    assert.equal((await fetch(`${base}/api/identify`)).status, 404);
  } finally {
    await server.close();
  }
});
