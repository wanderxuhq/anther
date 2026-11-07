import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalScreen, type ScreenCell, type TerminalScreen } from '../../../shared/terminal/vt.ts';
import { serializeDiff, serializeScreen } from '../../../shared/terminal/serialize.ts';
import { RemoteTerminalScreen } from './remote.ts';

function text(cells: readonly ScreenCell[]): string {
  return cells.map((cell) => cell.char).join('').trimEnd();
}

function rowsText(screen: TerminalScreen | RemoteTerminalScreen): string[] {
  const out: string[] = [];
  for (let row = 0; row < screen.totalRows(); row++) {
    out.push(text(screen.getRowAbsolute(row)));
  }
  return out;
}

test('applySnapshot：恢复全部行、光标和模式', () => {
  const server = createTerminalScreen({ cols: 10, rows: 3, scrollbackLimit: 10 });
  server.process('one\r\ntwo\r\nthree\r\nfour');
  server.process('\x1b[?25l\x1b[?2004h');

  const remote = new RemoteTerminalScreen();
  remote.applySnapshot(serializeScreen(server));
  assert.deepEqual(rowsText(remote), rowsText(server));
  assert.deepEqual(remote.getCursor(), server.getCursor());
  assert.equal(remote.getCursorVisible(), false);
  assert.equal(remote.getMode('bracketedPaste'), true);
  assert.equal(remote.getMode('altScreen'), false);
});

test('applySnapshot：保留自动换行续行标记', () => {
  const server = createTerminalScreen({ cols: 5, rows: 3, scrollbackLimit: 10 });
  server.process('abcdef');
  const remote = new RemoteTerminalScreen();
  remote.applySnapshot(serializeScreen(server));
  assert.equal(remote.isRowAbsoluteWrapped(0), false);
  assert.equal(remote.isRowAbsoluteWrapped(1), true);
});

test('applyDiff：只更新脏行并推进光标', () => {
  const server = createTerminalScreen({ cols: 10, rows: 3, scrollbackLimit: 10 });
  server.process('one\r\ntwo\r\nthree');
  const remote = new RemoteTerminalScreen();
  remote.applySnapshot(serializeScreen(server));
  server.takeDirty();
  remote.takeDirty();

  server.process('\x1b[2;1Htwo-updated');
  remote.applyDiff(serializeDiff(server, server.takeDirty()));
  assert.deepEqual(rowsText(remote), rowsText(server));
  assert.deepEqual(remote.getCursor(), server.getCursor());
  const dirty = remote.takeDirty();
  assert.ok(dirty.rows === 'all' || dirty.rows.size > 0);
});

test('applySnapshot：回滚超过上限后只保留最近的行', () => {
  const server = createTerminalScreen({ cols: 10, rows: 3, scrollbackLimit: 5 });
  for (let i = 1; i <= 20; i++) server.process(`${i}\r\n`);
  const snapshot = serializeScreen(server);
  assert.equal(snapshot.scrollback, 5);
  assert.equal(snapshot.total, 8);
  assert.equal(snapshot.lines.length, 8);
  assert.ok(snapshot.first > 0);

  const remote = new RemoteTerminalScreen();
  remote.applySnapshot(snapshot);
  assert.deepEqual(rowsText(remote), rowsText(server));
});

test('applyDiff：回滚截断后行号整体前移', () => {
  const server = createTerminalScreen({ cols: 10, rows: 2, scrollbackLimit: 4 });
  server.process('a\r\nb\r\nc\r\nd');
  const remote = new RemoteTerminalScreen();
  remote.applySnapshot(serializeScreen(server));
  assert.deepEqual(rowsText(remote), rowsText(server));

  // 手动构造 first 增大的 diff（真实服务端在截断时直接发 snapshot）。
  const shifted = {
    ...serializeScreen(server),
    first: server.firstRetainedRow() + 1,
    total: server.totalRows() - 1,
    lines: [],
    styles: [],
  };
  remote.applyDiff(shifted);
  assert.equal(remote.firstRetainedRow(), server.firstRetainedRow() + 1);
  assert.equal(remote.totalRows(), server.totalRows() - 1);
});
