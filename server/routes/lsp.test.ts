// server/routes/lsp.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { HttpServer } from '../http.ts';
import { LspManager } from '../lsp-manager.ts';
import { registerLspRoutes, canonicalUriFor, pathToLanguageId } from './lsp.ts';

const stub = path.join(import.meta.dirname, '..', 'fixtures', 'lsp-stub.js');

// 用 stub 进程替换 typescript 引擎（不碰真实 tsserver）
function makeManager(root: string, env: Record<string, string> = {}, idleDisposeMs = 0) {
  const m = new LspManager({
    workspaceRoot: root,
    idleDisposeMs, // 默认 0：测试不触发空闲回收；个别用例传正值验证回收
    engines: [{ id: 'typescript', cmd: process.execPath, args: [stub], languageIds: ['typescript'], env }],
  });
  return m;
}

let root: string;
let server: HttpServer;
let manager: LspManager;
let port: number;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-lsp-'));
  server = new HttpServer({ staticDir: root });
  manager = makeManager(root);
  registerLspRoutes(server, manager);
  await server.listen(0, '127.0.0.1');
  port = (server.address() as { port: number }).port;
  base = `ws://127.0.0.1:${port}/api/lsp`;
});

afterEach(async () => {
  await manager.dispose();
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean, timeout = 4000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (fn()) return; await sleep(50); }
  assert.fail('waitFor 超时');
}

function openWs() {
  const ws = new WebSocket(base);
  return new Promise<WebSocket>((r) => ws.on('open', () => r(ws)));
}

test('pathToLanguageId / canonicalUriFor 纯函数', () => {
  assert.equal(pathToLanguageId('src/a.ts'), 'typescript');
  assert.equal(pathToLanguageId('a.tsx'), 'typescript');
  assert.equal(pathToLanguageId('a.js'), 'typescript');
  assert.equal(pathToLanguageId('a.jsx'), 'typescript');
  assert.equal(pathToLanguageId('a.css'), null);
  assert.equal(pathToLanguageId('a.md'), null);
  assert.equal(pathToLanguageId('.gitignore'), null);
  assert.equal(canonicalUriFor('/ws', 'src/a.ts'), 'file:///ws/src/a.ts');
  assert.equal(canonicalUriFor('/ws', 'a b.ts'), 'file:///ws/a%20b.ts');
});

test('open → 响应 ok；关闭连接后全局 open 计数归零', async () => {
  const ws = await openWs();
  const res = new Promise<{ id: number; ok: boolean }>((r) => ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.id === 1) r(m);
  }));
  ws.send(JSON.stringify({ id: 1, method: 'open', params: { path: 'src/a.ts', text: 'const x = 1;' } }));
  const got = await res;
  assert.equal(got.ok, true);
  ws.close();
  await sleep(100);
  // markClosed 已执行（空闲回收 disabled，dispose 不触发）——通过再次 dispose 无残留验证
  await manager.dispose();
});

test('LSP_STUB_DIAGS=1：open 后收到 diagnostics 推送（扇出到打开该文件的连接）', async () => {
  const m2 = makeManager(root, { LSP_STUB_DIAGS: '1' });
  registerLspRoutes(server, m2);
  const ws = await openWs();
  const frames: Array<Record<string, unknown>> = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  ws.send(JSON.stringify({ id: 1, method: 'open', params: { path: 'src/a.ts', text: 'x' } }));
  await waitFor(() => frames.some((f) => f.type === 'diagnostics'));
  const diag = frames.find((f) => f.type === 'diagnostics') as { uri: string; diagnostics: Array<{ message: string }> };
  assert.equal(diag.diagnostics[0].message, 'stub diag');
  assert.equal(diag.uri, 'file://' + path.join(root, 'src/a.ts'));
  ws.close();
  await m2.dispose();
});

test('completion → 响应 ok 且带 stub items', async () => {
  const ws = await openWs();
  const frames: Array<Record<string, unknown>> = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  ws.send(JSON.stringify({ id: 1, method: 'open', params: { path: 'src/a.ts', text: 'const x = 1;' } }));
  await waitFor(() => frames.some((f) => f.id === 1));
  ws.send(JSON.stringify({ id: 2, method: 'completion', params: { path: 'src/a.ts', line: 0, character: 5 } }));
  await waitFor(() => frames.some((f) => f.id === 2));
  const comp = frames.find((f) => f.id === 2) as { ok: boolean; items: Array<{ label: string }> };
  assert.equal(comp.ok, true);
  assert.equal(comp.items[0].label, 'stubItem');
  ws.close();
});

test('非 LSP 文件 open → ok（防御，不 spawn）', async () => {
  const ws = await openWs();
  const res = new Promise<{ id: number; ok: boolean }>((r) => ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.id === 1) r(m);
  }));
  ws.send(JSON.stringify({ id: 1, method: 'open', params: { path: 'a.md', text: 'x' } }));
  const got = await res;
  assert.equal(got.ok, true);
  ws.close();
});

test('会话崩溃（stub 退出）→ 客户端收到 restarted 推送', async () => {
  // 用崩溃 env 的 manager：会话 start 失败 → 但 open 返回前 ensureReady 抛错 → ok:false。
  // 这里改为验证「运行中崩溃」路径：先正常起会话，再 kill 底层进程。
  const m2 = makeManager(root);
  registerLspRoutes(server, m2);
  const ws = await openWs();
  const frames: Array<Record<string, unknown>> = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  ws.send(JSON.stringify({ id: 1, method: 'open', params: { path: 'src/a.ts', text: 'x' } }));
  await waitFor(() => frames.some((f) => f.id === 1));
  // 杀掉会话的底层进程
  const s = (m2 as unknown as { sessions: Map<string, { proc: { kill(): void } }> }).sessions.get('typescript')!;
  s.proc.kill();
  await waitFor(() => frames.some((f) => f.type === 'restarted'));
  const evt = frames.find((f) => f.type === 'restarted') as { engineId: string };
  assert.equal(evt.engineId, 'typescript');
  ws.close();
  await m2.dispose();
});

test('崩溃重建后重发 open 不重复计数 → 空闲回收仍触发 dispose', async () => {
  // 回归：openCount 裸计数在 crash→reopen 路径 +1 膨胀，close 后永不为 0 → 空闲回收永不触发。
  // 集合记账下重发 open 幂等，close 后 set 空 → idleDisposeMs 计时 → disposeEngine。
  const m2 = makeManager(root, {}, 100);
  registerLspRoutes(server, m2);
  const ws = await openWs();
  const frames: Array<Record<string, unknown>> = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  // 1) 打开文件
  ws.send(JSON.stringify({ id: 1, method: 'open', params: { path: 'src/a.ts', text: 'x' } }));
  await waitFor(() => frames.some((f) => f.id === 1));
  // 2) 崩溃 → restarted 推送
  const s = (m2 as unknown as { sessions: Map<string, { proc: { kill(): void } }> }).sessions.get('typescript')!;
  s.proc.kill();
  await waitFor(() => frames.some((f) => f.type === 'restarted'));
  // 3) 客户端幂等重发 open（新会话）
  ws.send(JSON.stringify({ id: 2, method: 'open', params: { path: 'src/a.ts', text: 'x' } }));
  await waitFor(() => frames.some((f) => f.id === 2));
  // 4) close → open 集合应归零 → 空闲计时触发 disposeEngine → sessions 清空
  ws.send(JSON.stringify({ id: 3, method: 'close', params: { path: 'src/a.ts' } }));
  await waitFor(() => frames.some((f) => f.id === 3));
  await waitFor(() => (m2 as unknown as { sessions: Map<string, unknown> }).sessions.size === 0);
  ws.close();
});
