// server/terminal.test.ts
// TerminalManager 单测：创建/列表（每用户隔离）/所有权/关闭杀进程/退出自动移除/历史上限/批处理。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Terminal, TerminalManager } from './terminal.ts';
import { PtySession } from './pty.ts';

const cwd = process.cwd();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let m: TerminalManager;
beforeEach(() => { m = new TerminalManager(cwd); });
afterEach(async () => { await m.closeAll(); });

test('create：id 为 t_ 前缀、name 原样接收、列表按用户隔离', async () => {
  const a = await m.create('u1', 'Terminal 1');
  const b = await m.create('u1', 'Terminal 2');
  assert.match(a.id, /^t_[0-9a-f]+$/);
  assert.notEqual(a.id, b.id);
  assert.equal(m.list('u1').length, 2);
  assert.equal(m.list('u2').length, 0);
  assert.equal(m.list('u1')[0].name, 'Terminal 1');
  assert.equal(m.list('u1')[1].name, 'Terminal 2');
});

test('get：跨用户不可见（所有权校验）', async () => {
  const a = await m.create('u1', 'T');
  assert.ok(m.get('u1', a.id));
  assert.equal(m.get('u2', a.id), null);
});

test('close：杀进程并移出列表', async () => {
  const a = await m.create('u1', 'T');
  await m.close('u1', a.id);
  assert.equal(m.get('u1', a.id), null);
  assert.equal(m.list('u1').length, 0);
});

test('bash 退出 → 自动移除 + exit 事件', async () => {
  const a = await m.create('u1', 'T');
  const term = m.get('u1', a.id)!;
  const exited = new Promise<number>((r) => term.once('exit', r));
  term.write('exit\n');
  assert.equal(await exited, 0);
  await sleep(100); // manager 移除在 pty exit 同步链内，sleep 兜底
  assert.equal(m.get('u1', a.id), null);
});

test('output：40ms 批处理把连续 data 合并成一次 output', async () => {
  const a = await m.create('u1', 'T');
  const term = m.get('u1', a.id)!;
  const got: string[] = [];
  term.on('output', (b) => got.push(b));
  term.pty.emit('data', 'ab');
  term.pty.emit('data', 'cd');
  await sleep(80);
  const batch = got.find((b) => b.includes('abcd'));
  assert.ok(batch, `未找到合并批：${JSON.stringify(got)}`);
});

test('replay：包含全部历史（供重连画面恢复）', async () => {
  const a = await m.create('u1', 'T');
  const term = m.get('u1', a.id)!;
  term.pty.emit('data', 'alpha');
  term.pty.emit('data', 'beta');
  assert.ok(term.replay().includes('alpha'));
  assert.ok(term.replay().includes('beta'));
});

test('history：超上限截断（保留最近内容）', async () => {
  const p = new PtySession(cwd);
  await p.ready;
  const t = new Terminal('t_cap', 'T', p, 1000); // 1KB 上限便于测试
  t.pty.emit('data', 'a'.repeat(600));
  t.pty.emit('data', 'b'.repeat(600));
  assert.ok(t.replay().length <= 1000);
  assert.ok(t.replay().includes('bbb'), '应保留最近的 b 内容');
  await p.kill();
});
