import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalScreen, type ScreenCell } from '../../../shared/terminal/vt.ts';

function text(cells: readonly ScreenCell[]): string {
  return cells.map((cell) => cell.char).join('').replace(/ +$/, '');
}

function screen(cols = 20, rows = 4, scrollbackLimit = 100) {
  return createTerminalScreen({ cols, rows, scrollbackLimit });
}

test('基本文本、CR/LF 与光标', () => {
  const s = screen();
  s.process('hello');
  assert.equal(text(s.getRow(0)), 'hello');
  assert.deepEqual(s.getCursor(), { col: 5, row: 0 });
  s.process('\r\nworld');
  assert.equal(text(s.getRow(0)), 'hello');
  assert.equal(text(s.getRow(1)), 'world');
});

test('SGR：16 色、256 色、真彩色、粗体/下划线/反色', () => {
  const s = screen();
  s.process('\x1b[31mA\x1b[38;5;196mB\x1b[38;2;1;2;3mC\x1b[1;4;7mD\x1b[0mE');
  const row = s.getRow(0);
  assert.deepEqual(row[0].fg, { r: 128, g: 0, b: 0 });
  assert.deepEqual(row[1].fg, { r: 255, g: 0, b: 0 });
  assert.deepEqual(row[2].fg, { r: 1, g: 2, b: 3 });
  assert.equal(row[3].bold, true);
  assert.equal(row[3].underline, 'single');
  assert.equal(row[3].inverse, true);
  assert.equal(row[4].bold, false);
  assert.equal(row[4].fg, null);
});

test('光标移动与擦除', () => {
  const s = screen();
  s.process('abc\r\x1b[2DXY');
  assert.equal(text(s.getRow(0)), 'XYc');
  s.process('\x1b[1;1H\x1b[K');
  assert.equal(text(s.getRow(0)), '');
  s.process('abc\x1b[2D\x1b[K');
  assert.equal(text(s.getRow(0)), 'a');
});

test('滚动与回滚缓冲', () => {
  const s = screen(10, 3, 100);
  s.process('1\r\n2\r\n3\r\n4\r\n5');
  assert.equal(s.getScrollbackLength(), 2);
  assert.equal(s.totalRows(), 5);
  assert.equal(text(s.getRowAbsolute(0)), '1');
  assert.equal(text(s.getRowAbsolute(1)), '2');
  assert.equal(text(s.getRow(0)), '3');
  assert.equal(text(s.getRow(2)), '5');
});

test('alt screen 保存/恢复主屏幕', () => {
  const s = screen();
  s.process('main\x1b[?1049hALT');
  assert.equal(s.getMode('altScreen'), true);
  assert.equal(text(s.getRow(0)), 'ALT');
  s.process('\x1b[?1049l');
  assert.equal(s.getMode('altScreen'), false);
  assert.equal(text(s.getRow(0)), 'main');
  assert.deepEqual(s.getCursor(), { col: 4, row: 0 });
});

test('宽字符、emoji 与组合字符', () => {
  const s = screen();
  s.process('中a😀');
  const row = s.getRow(0);
  assert.equal(row[0].char, '中');
  assert.equal(row[0].wide, true);
  assert.equal(row[1].char, '');
  assert.equal(row[2].char, 'a');
  assert.equal(row[3].char, '😀');
  assert.equal(row[3].wide, true);
  assert.equal(s.getCursor().col, 5);

  const combining = screen();
  combining.process('e');
  combining.process('\u0301');
  assert.equal(combining.getRow(0)[0].char, 'e\u0301');
});

test('OSC：标题、cwd、超链接', () => {
  const s = screen();
  s.process('\x1b]0;hello title\x07\x1b]7;file://localhost/tmp\x07');
  assert.equal(s.getTitle(), 'hello title');
  assert.equal(s.getCwd(), 'file://localhost/tmp');
  s.process('\x1b]8;;https://example.com\x07x\x1b]8;;\x07');
  assert.equal(s.getRow(0)[0].url, 'https://example.com');
});

test('模式：bracketed paste、application cursor、光标形状/可见性', () => {
  const s = screen();
  s.process('\x1b[?2004h\x1b[?1h\x1b[?25l\x1b[5 q');
  assert.equal(s.getMode('bracketedPaste'), true);
  assert.equal(s.getMode('applicationCursor'), true);
  assert.equal(s.getCursorVisible(), false);
  assert.equal(s.getCursorShape(), 'bar');
  assert.equal(s.getCursorBlinking(), true);
  s.process('\x1b[?12l');
  assert.equal(s.getCursorBlinking(), false);
});

test('DEC Special Graphics 与 DECALN', () => {
  const s = screen();
  s.process('\x1b(0q\x1b(B');
  assert.equal(s.getRow(0)[0].char, '─');
  const fill = screen(4, 2);
  fill.process('\x1b#8');
  assert.equal(fill.getRow(0).every((cell) => cell.char === 'E'), true);
  assert.equal(fill.getRow(1).every((cell) => cell.char === 'E'), true);
});

test('DSR/DA1 回应', () => {
  const responses: string[] = [];
  const s = createTerminalScreen({ cols: 20, rows: 4, onResponse: (data) => responses.push(data) });
  s.process('\x1b[6n\x1b[c');
  assert.deepEqual(responses, ['\x1b[1;1R', '\x1b[?62;22c']);
});

test('脏行追踪：只报告变化的行', () => {
  const s = screen(10, 3);
  const initial = s.takeDirty();
  assert.equal(initial.rows, 'all');
  s.process('a');
  const first = s.takeDirty();
  assert.notEqual(first.rows, 'all');
  assert.equal((first.rows as Set<number>).has(0), true);
  s.process('b');
  const second = s.takeDirty();
  assert.equal((second.rows as Set<number>).has(0), true);
  s.process('\x1b[2;1Hc');
  const third = s.takeDirty();
  assert.equal((third.rows as Set<number>).has(1), true);
});

test('resize：列宽变化重排自动换行，行收缩进入回滚缓冲', () => {
  const s = screen(10, 3);
  s.process('abcde\r\nsecond\r\nthird');
  s.resize(4, 2);
  assert.equal(s.cols, 4);
  assert.equal(s.screenRows(), 2);
  assert.equal(s.getScrollbackLength(), 4);
  assert.equal(text(s.getRowAbsolute(0)), 'abcd');
  assert.equal(text(s.getRowAbsolute(1)), 'e');
  assert.equal(text(s.getRowAbsolute(2)), 'seco');
  assert.equal(text(s.getRowAbsolute(3)), 'nd');
  assert.equal(text(s.getRow(0)), 'thir');
  assert.equal(text(s.getRow(1)), 'd');
  assert.deepEqual(s.getCursor(), { row: 1, col: 1 });
});

test('resize：窄屏重排不丢自动换行处的字符', () => {
  const line = 'Links preserve the current file, Git view, and display settings across refresh and browser Back/Forward navigation.';
  const s = screen(44, 10);
  s.process(line + '\r\n');
  s.resize(42, 10);

  // 按 wrapped 标记拼回逻辑行，末尾空白不算内容。
  let joined = '';
  for (let row = 0; row < s.screenRows(); row++) {
    const rowText = s.getRow(row).map((cell) => cell.char).join('');
    if (row > 0 && s.isRowWrapped(row)) joined += rowText;
    else joined += '\n' + rowText;
  }
  assert.ok(joined.includes(line), `重排后丢了字符：${JSON.stringify(joined.slice(0, 140))}`);
});

test('resize：宽字符重排不拆开宽字符', () => {
  const s = screen(10, 4);
  s.process('中文中文中文');
  s.resize(7, 6);

  let joined = '';
  for (let row = 0; row < s.screenRows(); row++) {
    for (const cell of s.getRow(row)) if (cell.char !== '') joined += cell.char;
  }
  // 奇数宽度下宽字符行尾会补空格，比较时忽略这些占位空格。
  assert.ok(joined.replace(/ +/g, '').includes('中文中文中文'));

  for (let row = 0; row < s.screenRows(); row++) {
    const line = s.getRow(row);
    for (let col = 0; col < line.length; col++) {
      if (line[col].wide) assert.equal(line[col + 1]?.char, '');
    }
  }
});

test('resize：当前行跨自动换行时提示符不会被推进回滚区', () => {
  const s = screen(49, 36);
  const prompt = "root@localhost:~/projects/anther# printf '";
  s.process(prompt + '中');
  s.resize(44, 36);
  assert.equal(s.getScrollbackLength(), 0);
  assert.ok(text(s.getRow(0)).includes('root@localhost'));
  s.process("文中文中文\\n'");
  assert.equal(s.getText().split('\n').filter((line) => line.includes('root@localhost')).length, 1);
});

test('resize：光标在顶部时收缩高度不把提示符推进回滚区', () => {
  const s = screen(20, 10, 100);
  s.process('$ ');
  s.resize(20, 5);
  assert.equal(s.getScrollbackLength(), 0);
  assert.equal(s.getCursor().row, 0);
  assert.equal(text(s.getRow(0)), '$');
  s.resize(20, 3);
  assert.equal(s.getScrollbackLength(), 0);
  assert.equal(text(s.getRow(0)), '$');
  assert.equal(s.getText().split('\n').filter((line) => line.trim() === '$').length, 1);
});

test('resize：光标在底部时从顶部进回滚，提示符保留且不重复', () => {
  const s = screen(20, 6, 100);
  s.process('1\r\n2\r\n3\r\n4\r\n5\r\n$ ');
  s.resize(20, 3);
  assert.equal(s.getCursor().row, 2);
  assert.equal(text(s.getRow(2)), '$');
  assert.ok(s.getScrollbackLength() >= 3);
  assert.equal(s.getText().split('\n').filter((line) => line.trim() === '$').length, 1);
  s.resize(20, 6);
  assert.equal(s.getCursor().row, 2);
  assert.equal(text(s.getRow(2)), '$');
  assert.equal(s.getText().split('\n').filter((line) => line.trim() === '$').length, 1);
});

test('插入/删除字符、制表符', () => {
  const s = screen(20, 2);
  s.process('abc\x1b[2G\x1b[2@');
  assert.equal(text(s.getRow(0)), 'a  bc');
  s.process('\x1b[2G\x1b[2P');
  assert.equal(text(s.getRow(0)), 'abc');
  const tabs = screen(20, 2);
  tabs.process('a\tb');
  assert.equal(tabs.getRow(0)[8].char, 'b');
});

test('滚动区内的插入/删除行', () => {
  const s = screen(10, 5);
  s.process('1\r\n2\r\n3\r\n4\r\n5');
  s.process('\x1b[2;4r\x1b[2;1H\x1b[L');
  // 在滚动区顶部插入一行：原 2/3/4 下移，5 保留。
  assert.equal(text(s.getRow(0)), '1');
  assert.equal(text(s.getRow(1)), '');
  assert.equal(text(s.getRow(2)), '2');
  assert.equal(text(s.getRow(3)), '3');
  assert.equal(text(s.getRow(4)), '5');
});

test('自动换行标记：续行 wrapped，显式换行不标记', () => {
  const s = screen(5, 4);
  s.process('abcdef');
  assert.equal(text(s.getRow(0)), 'abcde');
  assert.equal(text(s.getRow(1)), 'f');
  assert.equal(s.isRowWrapped(0), false);
  assert.equal(s.isRowWrapped(1), true);
  s.process('\r\nxyz');
  assert.equal(s.isRowWrapped(2), false);
});

test('split grapheme across chunks：组合字符与 ZWJ', () => {
  const s = screen();
  s.process('e');
  s.process('\u0301');
  assert.equal(s.getRow(0)[0].char, 'e\u0301');
  s.process('\r\n👩');
  s.process('\u200d');
  s.process('💻');
  assert.equal(s.getRow(1)[0].char, '👩\u200d💻');
  assert.equal(s.getRow(1)[0].wide, true);
});
