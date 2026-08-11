// server/lsp-session.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { LspSession } from './lsp-session.ts';

const stub = path.join(import.meta.dirname, 'fixtures', 'lsp-stub.js');

function makeSession(env: Record<string, string> = {}, opts: Partial<ConstructorParameters<typeof LspSession>[0]> = {}) {
  // cmd/args/cwd 恒指向 stub，不被 opts 覆盖：先放默认、允许 opts 覆盖其余键，最后再强制回写。
  const forced = { cmd: process.execPath, args: [stub], cwd: process.cwd() };
  const session = new LspSession({
    ...forced,
    onDiagnostics: opts.onDiagnostics ?? (() => {}),
    onExit: opts.onExit ?? (() => {}),
    initializeTimeoutMs: 2000,
    requestTimeoutMs: 1000,
    ...opts,
    ...forced,
    env,
  });
  return session;
}

test('start → initialize 握手成功 → alive', async () => {
  const s = makeSession();
  await s.start();
  assert.equal(s.alive, true);
  await s.dispose();
});

test('open/change/close 透传不抛错（stub 无诊断）', async () => {
  const s = makeSession();
  await s.start();
  const uri = 'file:///tmp/a.ts';
  await s.open(uri, 'const x = 1;', 'typescript');
  await s.change(uri, 'const x = 2;');
  await s.close(uri);
  assert.equal(s.alive, true);
  await s.dispose();
});

test('LSP_STUB_DIAGS=1：open 后收到 publishDiagnostics', async () => {
  let got: unknown = null;
  const s = makeSession({ LSP_STUB_DIAGS: '1' }, { onDiagnostics: (uri, diags) => { got = { uri, diags }; } });
  await s.start();
  await s.open('file:///tmp/a.ts', 'x', 'typescript');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(got, '应收到诊断');
  assert.equal((got as { diags: Array<{ message: string }> }).diags[0].message, 'stub diag');
  await s.dispose();
});

test('completion 返回 stub 固定项', async () => {
  const s = makeSession();
  await s.start();
  const items = await s.completion('file:///tmp/a.ts', 0, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'stubItem');
  await s.dispose();
});

test('LSP_STUB_SILENT=1：initialize 超时 → start 抛错且 !alive', async () => {
  const s = makeSession({ LSP_STUB_SILENT: '1' });
  await assert.rejects(() => s.start(), /timeout/);
  assert.equal(s.alive, false);
});

test('LSP_STUB_CRASH=1：进程即退 → onExit 触发且 !alive', async () => {
  let code: number | null | undefined;
  const s = makeSession({ LSP_STUB_CRASH: '1' }, { onExit: (c) => { code = c; } });
  await assert.rejects(() => s.start(), /language server unavailable|timeout/);
  assert.equal(s.alive, false);
  assert.notEqual(code, undefined);
});

test('运行中崩溃：ready 后进程退出 → onExit 触发 → alive=false', async () => {
  let code: number | null | undefined;
  const s = makeSession({}, { onExit: (c) => { code = c; } });
  await s.start();
  assert.equal(s.alive, true);
  // 直接杀底层进程模拟崩溃
  const proc = (s as unknown as { proc: { kill(): void } }).proc;
  proc.kill();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(s.alive, false);
  assert.notEqual(code, undefined);
});
