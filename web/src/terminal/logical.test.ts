import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalScreen, type ScreenCell } from '../../../shared/terminal/vt.ts';
import { joinLogicalCells } from './logical.ts';

function text(cells: readonly ScreenCell[]): string {
  return cells.map((cell) => cell.char).join('').trimEnd();
}

test('joinLogicalCells：宽字符换行处不产生多余空格', () => {
  const s = createTerminalScreen({ cols: 7, rows: 4, scrollbackLimit: 0 });
  s.process('中文中文中文');
  const rows = [s.getRow(0), s.getRow(1)];
  assert.equal(s.isRowWrapped(1), true);
  assert.equal(text(joinLogicalCells(rows)), '中文中文中文');
});

test('joinLogicalCells：普通字符换行处的空格保留', () => {
  const s = createTerminalScreen({ cols: 4, rows: 4, scrollbackLimit: 0 });
  s.process('abc d');
  const rows = [s.getRow(0), s.getRow(1)];
  assert.equal(s.isRowWrapped(1), true);
  assert.equal(text(joinLogicalCells(rows)), 'abc d');
});

test('joinLogicalCells：单行直接返回原数组', () => {
  const s = createTerminalScreen({ cols: 10, rows: 2, scrollbackLimit: 0 });
  s.process('hello');
  const row = s.getRow(0);
  assert.equal(joinLogicalCells([row]), row);
});
