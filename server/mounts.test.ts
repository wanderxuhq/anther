// server/mounts.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { HttpServer, Router } from './http.ts';
import { createWorkspace, registerWorkspaceRoutes } from './workspace.ts';
import { MountRegistry } from './mounts.ts';
import { ATTACH_PATH, DETACH_PATH, isLoopback, registerAttachRoute, registerDetachRoute } from './routes/attach.ts';
import { registerIdentifyRoutes } from './routes/identify.ts';

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'anther-mount-'));
  const host = path.join(root, 'anther');
  const qlang = path.join(root, 'qlang');
  const otherQlang = path.join(root, 'other', 'qlang');
  await mkdir(host, { recursive: true });
  await mkdir(qlang, { recursive: true });
  await mkdir(otherQlang, { recursive: true });
  await writeFile(path.join(host, 'host.txt'), 'host');
  await writeFile(path.join(qlang, 'q.txt'), 'q');
  await writeFile(path.join(otherQlang, 'other.txt'), 'other');
  await writeFile(path.join(host, 'index.html'), '<!doctype html><html><head><title>x</title></head><body>app</body></html>');

  const http = new HttpServer({ staticDir: host });
  const attach = { available: true };
  const registry = new MountRegistry(http, () => attach);
  const workspace = createWorkspace(host);
  const hostRouter = new Router();
  registerWorkspaceRoutes(hostRouter, workspace, registry.providers());
  registerIdentifyRoutes(http, host, registry.providers());
  registerAttachRoute(http, registry, () => attach.available);
  registerDetachRoute(http, registry);
  await registry.addHost(host, workspace, hostRouter);
  await http.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  return { root, host, qlang, otherQlang, http, registry, attach, base };
}

async function get(base: string, url: string) {
  const res = await fetch(base + url, { redirect: 'manual' });
  return { status: res.status, text: await res.text(), location: res.headers.get('location') };
}

async function json(base: string, url: string) {
  const res = await fetch(base + url);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test('宿主根路径与宿主挂载别名各自独立，附加工作区按 base 路由', async () => {
  const f = await setup();
  try {
    const attached = await f.registry.attach(f.qlang);
    assert.equal(attached.existing, false);
    assert.equal(attached.mount.name, 'qlang');
    assert.equal(attached.mount.index, 0);

    assert.deepEqual(((await json(f.base, '/api/list?path=.')).body.entries as { name: string }[]).map((e) => e.name).sort(), ['host.txt', 'index.html']);
    for (const prefix of ['/-/anther', '/-/anther/-/0']) {
      const body = (await json(f.base, `${prefix}/api/list?path=.`)).body;
      assert.ok((body.entries as { name: string }[]).some((e) => e.name === 'host.txt'), prefix);
    }
    for (const prefix of ['/-/qlang', '/-/qlang/-/0']) {
      const body = (await json(f.base, `${prefix}/api/list?path=.`)).body;
      assert.deepEqual((body.entries as { name: string }[]).map((e) => e.name), ['q.txt'], prefix);
    }
  } finally {
    await f.http.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('同目录复用；同名 basename 递增 index；简写始终指向 index 0', async () => {
  const f = await setup();
  try {
    const first = await f.registry.attach(f.qlang);
    const again = await f.registry.attach(f.qlang);
    assert.equal(again.existing, true);
    assert.deepEqual(again.mount, first.mount);

    const hostAgain = await f.registry.attach(f.host);
    assert.equal(hostAgain.existing, true);
    assert.equal(hostAgain.mount.legacyRoot, true);

    const second = await f.registry.attach(f.otherQlang);
    assert.equal(second.existing, false);
    assert.equal(second.mount.name, 'qlang');
    assert.equal(second.mount.index, 1);
    assert.equal(second.mount.shorthand, null);
    assert.equal(second.mount.base, '/-/qlang/-/1');

    assert.deepEqual(((await json(f.base, '/-/qlang/api/list?path=.')).body.entries as { name: string }[]).map((e) => e.name), ['q.txt']);
    assert.deepEqual(((await json(f.base, '/-/qlang/-/1/api/list?path=.')).body.entries as { name: string }[]).map((e) => e.name), ['other.txt']);
  } finally {
    await f.http.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('/- 与 /-/ 是实例列表页；未知挂载导航回列表，/_/ 走 SPA', async () => {
  const f = await setup();
  try {
    assert.equal((await get(f.base, '/-')).status, 200);
    assert.equal((await get(f.base, '/-/')).status, 200);
    for (const url of ['/-/nope', '/-/nope/api/list', '/-/git', '/-/qlang/-/1']) {
      const res = await get(f.base, url);
      assert.equal(res.status, 302, url);
      assert.equal(res.location, '/-', url);
    }
    assert.equal((await get(f.base, '/_/git')).status, 200);
  } finally {
    await f.http.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('挂载 SPA 注入正确的 base；根路径不注入', async () => {
  const f = await setup();
  try {
    await f.registry.attach(f.qlang);
    for (const [url, base] of [
      ['/-/qlang/', '/-/qlang'],
      ['/-/qlang', '/-/qlang'],
      ['/-/qlang/-/0/', '/-/qlang/-/0'],
      ['/-/qlang/_/git', '/-/qlang'],
      ['/-/qlang/src/a.ts', '/-/qlang'],
    ] as const) {
      const res = await get(f.base, url);
      assert.equal(res.status, 200, url);
      assert.match(res.text, new RegExp(`window\\.__ANTHER_BASE__=${JSON.stringify(base)};`), url);
    }
    assert.doesNotMatch((await get(f.base, '/')).text, /__ANTHER_BASE__/);
    assert.doesNotMatch((await get(f.base, '/_/git')).text, /__ANTHER_BASE__/);
  } finally {
    await f.http.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('挂载路由：req.url 被剥前缀，WS 也按挂载分发', async () => {
  const f = await setup();
  try {
    const router = new Router();
    router.get('/api/url', (req) => ({ url: req.url }));
    router.ws('/api/echo', (ws) => {
      ws.on('message', (raw) => ws.send(raw));
    });
    f.http.mount(['/-/probe', '/-/probe/-/0'], router);

    const body = (await json(f.base, '/-/probe/api/url?x=1')).body;
    assert.equal(body.url, '/api/url?x=1');

    const ws = new WebSocket(`${f.base.replace('http', 'ws')}/-/probe/api/echo`);
    const msg = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => ws.send('hello'));
      ws.on('message', (d) => resolve(d.toString()));
      ws.on('error', reject);
    });
    assert.equal(msg, 'hello');
    ws.close();
  } finally {
    await f.http.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('附加不存在的目录 / 非目录被拒绝', async () => {
  const f = await setup();
  try {
    await assert.rejects(f.registry.attach(path.join(f.root, 'missing')), /not a directory/);
    await writeFile(path.join(f.root, 'file.txt'), 'x');
    await assert.rejects(f.registry.attach(path.join(f.root, 'file.txt')), /not a directory/);
  } finally {
    await f.http.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('isLoopback 只接受 IPv4/IPv6 回环来源', () => {
  const req = (address: string) => ({ socket: { remoteAddress: address } }) as unknown as IncomingMessage;
  assert.equal(isLoopback(req('127.0.0.1')), true);
  assert.equal(isLoopback(req('::1')), true);
  assert.equal(isLoopback(req('::ffff:127.0.0.1')), true);
  assert.equal(isLoopback(req('192.168.1.10')), false);
  assert.equal(isLoopback(req('::ffff:192.168.1.10')), false);
  assert.equal(isLoopback(req('')), false);
});

test('loopback POST /api/anther/attach：附加、同目录复用、错误和禁用', async () => {
  const f = await setup();
  try {
    const post = (body: unknown) => fetch(f.base + ATTACH_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const first = await post({ workspace: f.qlang });
    assert.equal(first.status, 200);
    const firstBody = await first.json() as { existing: boolean; mount: { base: string } };
    assert.equal(firstBody.existing, false);
    assert.equal(firstBody.mount.base, '/-/qlang/-/0');

    const again = await post({ workspace: f.qlang });
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { existing: boolean }).existing, true);

    assert.equal((await post({})).status, 400);
    const file = path.join(f.root, 'file.txt');
    await writeFile(file, 'x');
    assert.equal((await post({ workspace: file })).status, 400);

    f.attach.available = false;
    assert.equal((await post({ workspace: f.otherQlang })).status, 403);
  } finally {
    await f.http.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('detach：卸载、未挂载返回 null、宿主可卸载并重新挂载复用 index', async () => {
  const f = await setup();
  try {
    const postAttach = (workspace: string) => fetch(f.base + ATTACH_PATH, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace }),
    });
    const postDetach = (workspace: string) => fetch(f.base + DETACH_PATH, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace }),
    });

    const attached = await f.registry.attach(f.qlang);
    assert.equal(attached.mount.index, 0);
    const detached = await postDetach(f.qlang);
    assert.equal(detached.status, 200);
    const detachedBody = await detached.json() as { detached: { index: number } | null };
    assert.equal(detachedBody.detached?.index, 0);
    const detachedPage = await get(f.base, '/-/qlang/api/list?path=.');
    assert.equal(detachedPage.status, 302);
    assert.equal(detachedPage.location, '/-');

    const notMounted = await postDetach(f.qlang);
    assert.equal(notMounted.status, 200);
    assert.equal(((await notMounted.json()) as { detached: unknown }).detached, null);

    // 同一目录重新 attach：复用 index 0 和简写
    const again = await postAttach(f.qlang);
    const againBody = await again.json() as { mount: { index: number; shorthand: string | null } };
    assert.equal(againBody.mount.index, 0);
    assert.equal(againBody.mount.shorthand, '/-/qlang');

    // 同名不同目录：使用 next index，不复用被 detach 的 0
    await postDetach(f.qlang);
    const other = await f.registry.attach(f.otherQlang);
    assert.equal(other.mount.index, 1);
    assert.equal(other.mount.shorthand, null);

    // 原目录回来：复用 0；index 1 仍保留
    const original = await postAttach(f.qlang);
    const originalBody = await original.json() as { mount: { index: number; shorthand: string | null } };
    assert.equal(originalBody.mount.index, 0);
    assert.equal(originalBody.mount.shorthand, '/-/qlang');
    assert.deepEqual(((await json(f.base, '/-/qlang/api/list?path=.')).body.entries as { name: string }[]).map((e) => e.name), ['q.txt']);
    assert.deepEqual(((await json(f.base, '/-/qlang/-/1/api/list?path=.')).body.entries as { name: string }[]).map((e) => e.name), ['other.txt']);

    // 宿主也能 detach：/ 变空，但 shell 和 /- 页面仍可用
    const hostDetach = await postDetach(f.host);
    const hostBody = await hostDetach.json() as { detached: { legacyRoot: boolean } | null };
    assert.equal(hostBody.detached?.legacyRoot, true);
    assert.equal((await json(f.base, '/api/list?path=.')).status, 404);
    for (const url of ['/', '/foo', '/_/git']) {
      const res = await get(f.base, url);
      assert.equal(res.status, 302, url);
      assert.equal(res.location, '/-', url);
    }
    assert.equal((await get(f.base, '/-/')).status, 200);
    assert.equal((await json(f.base, '/api/anther')).status, 200);

    // 宿主重新 attach：复用 /、/-/anther、/-/anther/-/0
    const hostBack = await postAttach(f.host);
    const hostBackBody = await hostBack.json() as { mount: { index: number; legacyRoot: boolean; shorthand: string | null } };
    assert.equal(hostBackBody.mount.index, 0);
    assert.equal(hostBackBody.mount.legacyRoot, true);
    assert.equal(hostBackBody.mount.shorthand, '/-/anther');
    assert.deepEqual(((await json(f.base, '/api/list?path=.')).body.entries as { name: string }[]).map((e) => e.name).sort(), ['host.txt', 'index.html']);
    assert.equal((await get(f.base, '/')).status, 200);
    assert.equal((await get(f.base, '/foo')).status, 200);
  } finally {
    await f.http.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('/api/anther 返回 attach 和 mounts；宿主在 mounts 中且标记 legacyRoot', async () => {
  const f = await setup();
  try {
    await f.registry.attach(f.qlang);
    const body = (await json(f.base, '/api/anther')).body as {
      attach: { available: boolean };
      mounts: { name: string; index: number; legacyRoot: boolean; base: string; shorthand: string | null }[];
    };
    assert.deepEqual(body.attach, { available: true });
    assert.equal(body.mounts.length, 2);
    const host = body.mounts.find((m) => m.legacyRoot)!;
    assert.equal(host.name, 'anther');
    assert.equal(host.index, 0);
    assert.equal(host.base, '/-/anther/-/0');
    assert.equal(host.shorthand, '/-/anther');
    const qlang = body.mounts.find((m) => m.name === 'qlang')!;
    assert.equal(qlang.index, 0);
    assert.equal(qlang.base, '/-/qlang/-/0');
    assert.equal(qlang.shorthand, '/-/qlang');
  } finally {
    await f.http.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
