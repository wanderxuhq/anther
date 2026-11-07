// server/terminal.test.ts
// TerminalManager 单测：创建/列表（每用户隔离）/所有权/关闭杀进程/退出自动移除/屏幕快照与 diff。
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

test('screen：40ms 批处理把连续 data 合并成一次屏幕更新', async () => {
  const a = await m.create('u1', 'T');
  const term = m.get('u1', a.id)!;
  const got: string[] = [];
  term.on('screen', (message) => got.push(JSON.stringify(message)));
  term.pty.emit('data', 'ab');
  term.pty.emit('data', 'cd');
  await sleep(80);
  assert.ok(got.some((batch) => batch.includes('abcd')), `未找到合并批：${JSON.stringify(got)}`);
});

test('snapshot：包含屏幕/光标/尺寸，供连接时重建画面', async () => {
  const handlers: Array<(chunk: string) => void> = [];
  const fake = {
    on: (event: string, handler: (chunk: string) => void) => { if (event === 'data') handlers.push(handler); },
    write: () => {},
    resize: async () => {},
    kill: async () => {},
  } as unknown as PtySession;
  const term = new Terminal('t_snap', 'T', fake);
  await term.resize(20, 5);
  for (const handler of handlers) handler('hello');
  const message = term.snapshotMessage();
  assert.equal(message.type, 'screen');
  assert.equal(message.cols, 20);
  assert.equal(message.rows, 5);
  assert.deepEqual(message.cursor, { row: 0, col: 5 });
  const text = message.lines.map((line) => line.runs.map(([, value]) => value).join('')).join('\n');
  assert.match(text, /hello/);
  await term.close();
});

test('diff：只发送脏行，包含新进入回滚区的行', async () => {
  const handlers: Array<(chunk: string) => void> = [];
  const fake = {
    on: (event: string, handler: (chunk: string) => void) => { if (event === 'data') handlers.push(handler); },
    write: () => {},
    resize: async () => {},
    kill: async () => {},
  } as unknown as PtySession;
  const term = new Terminal('t_diff', 'T', fake);
  await term.resize(20, 4);
  await sleep(60); // 先让 resize 的全量 dirty 在无订阅时被清掉
  const messages: Array<{ type: string; lines?: Array<{ row: number }> }> = [];
  term.on('screen', (message) => messages.push(message));
  const feed = (data: string) => { for (const handler of handlers) handler(data); };
  feed('\x1b[1;1Hone\r\ntwo\r\nthree\r\nfour\r\nfive');
  await sleep(80);
  const last = messages.at(-1)!;
  assert.equal(last.type, 'screen-diff');
  assert.ok(last.lines && last.lines.length > 0);
  await term.close();
});

test('DSR6：服务端按光标位置回应，DA1/DSR5 只回一次', async () => {
  const handlers: Array<(chunk: string) => void> = [];
  const writes: string[] = [];
  const fake = {
    on: (event: string, handler: (chunk: string) => void) => { if (event === 'data') handlers.push(handler); },
    write: (data: string) => writes.push(data),
    resize: async () => {},
    kill: async () => {},
  } as unknown as PtySession;
  const term = new Terminal('t_test', 'T', fake);
  await term.resize(80, 24);
  const feed = (data: string) => { for (const handler of handlers) handler(data); };

  feed('\x1b[5;10H');
  feed('\x1b[6n');
  assert.deepEqual(writes, ['\x1b[5;10R']);

  writes.length = 0;
  feed('\x1b[?6n');
  assert.deepEqual(writes, ['\x1b[?5;10R']);

  writes.length = 0;
  feed('\x1b[c\x1b[5n');
  assert.deepEqual(writes, ['\x1b[?62;22c', '\x1b[0n']);
  await term.close();
});


