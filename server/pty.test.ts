// server/pty.test.ts
// PTY 集成测试：依赖 util-linux `script`、GNU `stty` 与 bash（Linux）。无 script 时跳过。
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PtySession } from './pty.ts';

const cwd = process.cwd();
const hasScript = spawnSync('which', ['script']).status === 0;

// 每个用例必须有上限，并且无论断言/超时都要杀掉 PTY：泄漏的 script/bash 会
// 持有 worker 的 stdio，让 node --test 永远等不到文件退出（整套测试挂住）。
const PTY_TIMEOUT = 30_000;

function pty(name: string, fn: (t: TestContext) => Promise<void>): void {
  test(name, {
    timeout: PTY_TIMEOUT,
    skip: hasScript ? false : '无 script，跳过 PTY 集成测试',
  }, fn);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Create a session owned by the test; cleanup runs even when the test fails or times out. */
function session(t: TestContext, dir = cwd): PtySession {
  const p = new PtySession(dir);
  t.after(() => p.kill());
  return p;
}

/** 收集输出直到匹配 re（按轮询次数限定，避免墙钟跳变误判超时） */
async function untilMatch(p: PtySession, re: RegExp, nominalMs = 15_000): Promise<string> {
  let buf = '';
  const onData = (d: string) => { buf += d; };
  p.on('data', onData);
  const maxPolls = Math.max(1, Math.round(nominalMs / 50));
  for (let poll = 0; poll < maxPolls; poll++) {
    if (re.test(buf)) { p.off('data', onData); return buf; }
    await sleep(50);
  }
  p.off('data', onData);
  assert.fail(`超时未匹配 ${re}，已有输出：${JSON.stringify(buf.slice(-200))}`);
}

pty('ready：marker 解析出 pty 设备路径', async (t) => {
  const p = session(t);
  await p.ready;
  assert.match(p.readyDevPath ?? '', /^\/dev\/pts\/\d+$/);
});

pty('write：输入回显到输出', async (t) => {
  const p = session(t);
  await p.ready;
  // 先挂监听再写：高负载下输出可能在 write 返回后立刻到达。
  const match = untilMatch(p, /HELLO-PTY/);
  p.write('echo HELLO-PTY\n');
  await match;
});

pty('resize：stty -F 改尺寸，stty size 读到新值', async (t) => {
  const p = session(t);
  await p.ready;
  await p.resize(100, 40);
  // Read the kernel PTY size directly: waiting for the interactive shell to echo
  // `stty size` was timing-sensitive under parallel test load.
  const size = spawnSync('stty', ['-F', p.readyDevPath!, 'size'], { encoding: 'utf8' });
  assert.equal(size.status, 0, size.stderr);
  assert.equal(size.stdout.trim(), '40 100');
});

pty('exit：bash 退出触发 exit 事件（code 0）', async (t) => {
  const p = session(t);
  await p.ready;
  const code = new Promise<number>((r) => p.on('exit', r));
  p.write('exit\n');
  assert.equal(await code, 0);
});

pty('kill：SIGTERM 杀 script，bash 树随之消失', async (t) => {
  const p = session(t);
  await p.ready;
  const code = new Promise<number>((r) => p.on('exit', r));
  await p.kill();
  assert.equal(await code, 0);
});

pty('spawn 失败：cwd 不存在 → ready reject（不挂起、不崩进程）', async (t) => {
  const p = session(t, '/nonexistent-dir-anther-test');
  await assert.rejects(p.ready);
});

pty('script 在 marker 前退出 → ready reject 而不是永久等待', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'anther-fake-pty-'));
  const previous = process.env.PATH;
  writeFileSync(path.join(dir, 'script'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
  process.env.PATH = `${dir}${path.delimiter}${previous ?? ''}`;
  t.after(() => {
    process.env.PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const p = session(t);
  await assert.rejects(p.ready, /exited before ready/);
});
