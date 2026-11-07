import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalScreen, type ScreenCell } from '../../../shared/terminal/vt.ts';
import { deserializeRow, serializeScreen } from '../../../shared/terminal/serialize.ts';

function text(cells: readonly ScreenCell[]): string {
  return cells.map((cell) => cell.char).join('').trimEnd();
}

function rawText(cells: readonly ScreenCell[]): string {
  return cells.map((cell) => cell.char).join('');
}

test('快照往返：颜色、背景空格、下划线、OSC 8 链接', () => {
  const screen = createTerminalScreen({ cols: 24, rows: 3 });
  screen.process('\x1b[31mred\x1b[0m plain \x1b[44m blue-bg \x1b[0m');
  screen.process('\x1b]8;;https://example.com\x07link\x1b]8;;\x07');

  const snapshot = serializeScreen(screen);
  const row = deserializeRow(snapshot.lines[0], snapshot.styles, snapshot.cols);
  assert.equal(text(row), 'red plain  blue-bg link');

  const red = row[0];
  assert.deepEqual(red.fg, { r: 128, g: 0, b: 0 });
  const blue = row.find((cell) => cell.char === 'b' && cell.bg);
  assert.deepEqual(blue?.bg, { r: 0, g: 0, b: 128 });
  const link = row.find((cell) => cell.char === 'l' && cell.url);
  assert.equal(link?.url, 'https://example.com');
});

test('自动换行续行前的行保留末尾空格', () => {
  const screen = createTerminalScreen({ cols: 5, rows: 3, scrollbackLimit: 10 });
  screen.process('abcd e');
  assert.equal(screen.isRowWrapped(1), true);
  const snapshot = serializeScreen(screen);
  const first = deserializeRow(snapshot.lines[0], snapshot.styles, snapshot.cols);
  assert.equal(rawText(first), 'abcd ');
});

test('快照保留自动换行续行标记', () => {
  const screen = createTerminalScreen({ cols: 5, rows: 3, scrollbackLimit: 10 });
  screen.process('abcdef');
  const snapshot = serializeScreen(screen);
  assert.equal(snapshot.lines[0].wrapped, false);
  assert.equal(snapshot.lines[1].wrapped, true);
});

test('快照往返：宽字符会重建占位格', () => {
  const screen = createTerminalScreen({ cols: 10, rows: 2 });
  screen.process('a中b');
  const snapshot = serializeScreen(screen);
  const row = deserializeRow(snapshot.lines[0], snapshot.styles, snapshot.cols);
  assert.equal(row[0].char, 'a');
  assert.equal(row[1].char, '中');
  assert.equal(row[1].wide, true);
  assert.equal(row[2].char, '');
  assert.equal(row[3].char, 'b');
});

test('快照往返：保留行尾有背景的空白', () => {
  const screen = createTerminalScreen({ cols: 8, rows: 2 });
  screen.process('\x1b[41m  \x1b[0m');
  const snapshot = serializeScreen(screen);
  const row = deserializeRow(snapshot.lines[0], snapshot.styles, snapshot.cols);
  assert.equal(row[0].char, ' ');
  assert.equal(row[1].char, ' ');
  assert.deepEqual(row[1].bg, { r: 128, g: 0, b: 0 });
});
