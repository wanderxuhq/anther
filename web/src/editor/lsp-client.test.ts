// web/src/editor/lsp-client.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pathToLanguageId, offsetToPosition, positionToOffset,
  completionItemToCm, diagnosticToCm,
} from './lsp-client.ts';

test('pathToLanguageId 扩展名映射', () => {
  assert.equal(pathToLanguageId('src/a.ts'), 'typescript');
  assert.equal(pathToLanguageId('a.tsx'), 'typescript');
  assert.equal(pathToLanguageId('a.js'), 'typescript');
  assert.equal(pathToLanguageId('a.jsx'), 'typescript');
  assert.equal(pathToLanguageId('a.d.ts'), 'typescript'); // .d.ts 的 ext 是 ts
  assert.equal(pathToLanguageId('a.css'), null);
  assert.equal(pathToLanguageId('a.md'), null);
  assert.equal(pathToLanguageId('.gitignore'), null);
  assert.equal(pathToLanguageId('a'), null);
});

test('offsetToPosition / positionToOffset 往返（ASCII / 中文 / emoji / CRLF）', () => {
  const samples = [
    'const x = 1;\n',
    '你好世界\n第二行\n',
    'a😀b\nc\r\nd\n',
  ];
  for (const text of samples) {
    for (let off = 0; off <= text.length; off++) {
      const pos = offsetToPosition(text, off);
      const back = positionToOffset(text, pos);
      assert.equal(back, off, `offset ${off} in ${JSON.stringify(text)}`);
    }
  }
});

test('positionToOffset 越界钳制到文档长度', () => {
  assert.equal(positionToOffset('ab', { line: 99, character: 5 }), 2);
  assert.equal(positionToOffset('ab\ncd', { line: 0, character: 99 }), 2);
});

test('completionItemToCm 映射（kind / detail / documentation / 未知 kind 兜底）', () => {
  const c = completionItemToCm({ label: 'foo', kind: 3, detail: 'd', documentation: 'doc' });
  assert.equal(c.label, 'foo');
  assert.equal(c.type, 'function');
  assert.equal(c.detail, 'd');
  assert.equal(c.info, 'doc');
  const objDoc = completionItemToCm({ label: 'x', kind: 999, documentation: { value: 'vd' } });
  assert.equal(objDoc.type, 'text'); // 未知 kind → 兜底
  assert.equal(objDoc.info, 'vd');
});

test('diagnosticToCm：severity 映射 + range 钳制', () => {
  const d1 = diagnosticToCm({ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, message: 'err', severity: 1 }, 'ab\ncde');
  assert.equal(d1.from, 3);
  assert.equal(d1.to, 6);
  assert.equal(d1.severity, 'error');
  const d2 = diagnosticToCm({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 99 } }, message: 'w', severity: 2 }, 'ab');
  assert.equal(d2.to, 2); // 越界钳到长度
  assert.equal(d2.severity, 'warning');
  const d3 = diagnosticToCm({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'i', severity: 3 }, 'ab');
  assert.equal(d3.severity, 'info');
});
