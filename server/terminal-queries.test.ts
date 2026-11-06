import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalQueryResponder, type TerminalQueryMeta } from './terminal-queries.ts';

function setup(meta: TerminalQueryMeta = {}, size = { cols: 80, rows: 24 }) {
  const out: string[] = [];
  const responder = new TerminalQueryResponder(
    (data) => out.push(data),
    () => size,
    () => meta,
  );
  return { responder, out };
}

test('DA1 / DA2 / DSR5 立即回应', () => {
  const { responder, out } = setup();
  responder.feed('\x1b[c\x1b[0c\x1b[>c\x1b[>0c\x1b[5n');
  assert.deepEqual(out, [
    '\x1b[?62;22c',
    '\x1b[?62;22c',
    '\x1b[>0;1;0c',
    '\x1b[>0;1;0c',
    '\x1b[0n',
  ]);
});

test('窗口 / 像素 / 单元格 / 屏幕尺寸', () => {
  const { responder, out } = setup({
    pixelWidth: 800, pixelHeight: 480, cellWidth: 10, cellHeight: 20,
  });
  responder.feed('\x1b[14t\x1b[16t\x1b[18t\x1b[19t');
  assert.deepEqual(out, [
    '\x1b[4;480;800t',
    '\x1b[6;20;10t',
    '\x1b[8;24;80t',
    '\x1b[9;24;80t',
  ]);
});

test('OSC 10/11/12 颜色查询', () => {
  const { responder, out } = setup({
    fg: { r: 30, g: 30, b: 30 },
    bg: { r: 255, g: 255, b: 255 },
    cursor: { r: 30, g: 30, b: 30 },
  });
  responder.feed('\x1b]10;?\x07\x1b]11;?\x07\x1b]12;?\x07');
  assert.deepEqual(out, [
    '\x1b]10;rgb:1e1e/1e1e/1e1e\x1b\\',
    '\x1b]11;rgb:ffff/ffff/ffff\x1b\\',
    '\x1b]12;rgb:1e1e/1e1e/1e1e\x1b\\',
  ]);
});

test('跨 chunk 的 CSI / OSC', () => {
  const { responder, out } = setup({ bg: { r: 0, g: 0, b: 0 } });
  responder.feed('\x1b');
  responder.feed('[');
  responder.feed('c');
  responder.feed('\x1b]11');
  responder.feed(';?');
  responder.feed('\x07');
  assert.deepEqual(out, ['\x1b[?62;22c', '\x1b]11;rgb:0000/0000/0000\x1b\\']);
});

test('不回应 DSR6 / DECRQM / 已经是对应的回应序列', () => {
  const { responder, out } = setup({ fg: { r: 1, g: 2, b: 3 }, bg: { r: 4, g: 5, b: 6 } });
  responder.feed('\x1b[6n\x1b[?1004$p');
  responder.feed('\x1b[?62;22c\x1b[>0;1;0c\x1b[8;24;80t\x1b[0n');
  responder.feed('\x1b]11;rgb:ffff/ffff/ffff\x1b\\');
  assert.deepEqual(out, []);
});

test('没有 meta 颜色时不回 OSC，但 DA/尺寸仍回', () => {
  const { responder, out } = setup();
  responder.feed('\x1b]11;?\x07\x1b[c\x1b[18t');
  assert.deepEqual(out, ['\x1b[?62;22c', '\x1b[8;24;80t']);
});
