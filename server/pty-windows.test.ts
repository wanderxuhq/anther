// server/pty-windows.test.ts
// Windows 原生 PTY 集成测试。非 Windows 或缺少 node-pty 时跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { WindowsPtySession } from './pty-windows.ts';
import { resolveShell } from './shell.ts';

const require = createRequire(import.meta.url);

function hasWindowsPty(): boolean {
  if (process.platform !== 'win32') return false;
  for (const name of ['@wanderxuhq/anther-node-pty', 'node-pty']) {
    try {
      require(name);
      return true;
    } catch { /* 继续尝试下一个 */ }
  }
  return false;
}

const available = hasWindowsPty();
const skip = available ? false : '需要 Windows + node-pty';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForOutput(session: WindowsPtySession, re: RegExp, nominalMs = 10_000): Promise<string> {
  let buffer = '';
  const onData = (data: string) => { buffer += data; };
  session.on('data', onData);
  try {
    for (let elapsed = 0; elapsed < nominalMs; elapsed += 50) {
      if (re.test(buffer)) return buffer;
      await sleep(50);
    }
    assert.fail(`输出未匹配 ${re}，已收到：${JSON.stringify(buffer.slice(-300))}`);
  } finally {
    session.off('data', onData);
  }
}

test('cmd：启动、输入、UTF-8、resize', { skip, timeout: 30_000 }, async (t) => {
  const spec = await resolveShell('cmd');
  const session = new WindowsPtySession(process.cwd(), spec);
  t.after(() => session.kill());
  await session.ready;
  assert.ok(session.pid > 0);
  assert.equal(spec.kind, 'cmd');

  const output = waitForOutput(session, /中文 HELLO/);
  session.write('echo 中文 HELLO\r');
  await output;

  // resize 不应抛错，且后续输入仍然正常
  await session.resize(100, 40);
  const after = waitForOutput(session, /AFTER-RESIZE/);
  session.write('echo AFTER-RESIZE\r');
  await after;
});

test('cmd：exit 事件与 kill 清理', { skip, timeout: 30_000 }, async (t) => {
  const spec = await resolveShell('cmd');
  const first = new WindowsPtySession(process.cwd(), spec);
  t.after(() => first.kill());
  await first.ready;
  const exited = new Promise<number>((resolve) => first.once('exit', resolve));
  first.write('exit\r');
  assert.equal(await exited, 0);

  const second = new WindowsPtySession(process.cwd(), spec);
  await second.ready;
  const killed = new Promise<number>((resolve) => second.once('exit', resolve));
  await second.kill();
  // kill 的退出码由 ConPTY 决定（常见 0xC000013A），只要求事件到达。
  assert.equal(typeof await killed, 'number');
});
