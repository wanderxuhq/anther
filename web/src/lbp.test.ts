import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseLBP, serializeLBP, pointFromDom, LBPResolver } from './readers/lbp.ts';
import { compactLBP, locationLBP } from './readers/location.ts';

test('Leaf Reader LBP preserves nested inline text and UTF-16 offsets independently of layout', () => {
  const dom = new JSDOM('<body><p data-lidx="0">Hello <em data-lidx="0">世界🌿</em> rest</p><p data-lidx="1">Next</p></body>');
  try {
    const root = dom.window.document.body, node = root.querySelector('em')!.firstChild!;
    const point = pointFromDom('中文/book.epub', 3, root, node, 2);
    assert.equal(serializeLBP(point), '中文/book.epub::3@0/0#2');
    root.style.width = '320px'; root.style.fontSize = '24px';
    const restored = LBPResolver.rangeInChapter(root, 3, parseLBP(serializeLBP(point))!)!;
    assert.equal(restored.startContainer, node); assert.equal(restored.startOffset, 2);
    assert.equal(compactLBP(point), '3@0/0#2');
    assert.deepEqual(locationLBP(compactLBP(point))!.start, point.start);
  } finally { dom.window.close(); }
});

test('LBP addresses body text, ranges and missing elements without changing selection', () => {
  const dom = new JSDOM('<body>Direct text<p data-lidx="0">nested <em data-lidx="0">inline</em> tail</p></body>');
  try {
    const root = dom.window.document.body;
    const direct = pointFromDom('book', 0, root, root.firstChild!, 3);
    assert.equal(serializeLBP(direct), 'book::0@#3');
    const range = parseLBP('book::0@0#3-0@0#12')!;
    assert.equal(LBPResolver.rangeInChapter(root, 0, range)!.toString(), 'ted inlin');
    assert.equal(LBPResolver.resolvePoint(root, { spineIndex: 0, elementPath: [99], charOffset: 0 }), null);
    assert.equal(dom.window.getSelection()!.rangeCount, 0);
  } finally { dom.window.close(); }
});
