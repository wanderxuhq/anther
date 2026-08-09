// server/pty.test.ts
// PTY 集成测试：依赖 util-linux `script`（Linux/macOS）。无 script 时跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PtySession } from './pty.ts';

const cwd = process.cwd();
const hasScript = spawnSync('which', ['script']).status === 0;
const pty = hasScript
  ? test
  : (name: string, fn: () => void) => test(name, { skip: '无 script，跳过 PTY 集成测试' }, fn);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 收集输出直到匹配 re 或超时（默认 4s） */
async function untilMatch(p: PtySession, re: RegExp, timeout = 4000): Promise<string> {
  let buf = '';
  const onData = (d: string) => { buf += d; };
  p.on('data', onData);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (re.test(buf)) { p.off('data', onData); return buf; }
    await sleep(50);
  }
  p.off('data', onData);
  assert.fail(`超时未匹配 ${re}，已有输出：${JSON.stringify(buf.slice(-200))}`);
}

pty('ready：marker 解析出 pty 设备路径', async () => {
  const p = new PtySession(cwd);
  await p.ready;
  assert.match(p.readyDevPath ?? '', /^\/dev\/pts\/\d+$/);
  await p.kill();
});

pty('write：输入回显到输出', async () => {
  const p = new PtySession(cwd);
  await p.ready;
  p.write('echo HELLO-PTY\n');
  await untilMatch(p, /HELLO-PTY/);
  await p.kill();
});

pty('resize：stty -F 改尺寸，stty size 读到新值', async () => {
  const p = new PtySession(cwd);
  await p.ready;
  await p.resize(100, 40);
  p.write('stty size\n');
  await untilMatch(p, /40 100/);
  await p.kill();
});

pty('exit：bash 退出触发 exit 事件（code 0）', async () => {
  const p = new PtySession(cwd);
  await p.ready;
  const code = new Promise<number>((r) => p.on('exit', r));
  p.write('exit\n');
  assert.equal(await code, 0);
});

pty('kill：SIGTERM 杀 script，bash 树随之消失', async () => {
  const p = new PtySession(cwd);
  await p.ready;
  const code = new Promise<number>((r) => p.on('exit', r));
  await p.kill();
  assert.equal(await code, 0);
});

pty('spawn 失败：cwd 不存在 → ready reject（不挂起、不崩进程）', async () => {
  const p = new PtySession('/nonexistent-dir-anther-test');
  await assert.rejects(p.ready);
  await p.kill(); // 已失败的进程：kill 立即 resolve
});
