// web/src/editor/lint.test.ts
// collectErrorRanges 是纯函数（输入 syntaxTree，输出 ErrorRange[]），node --test 直测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { collectErrorRanges } from './lint.ts';

test('JS 合法代码：无 error 区间', () => {
  const state = EditorState.create({ doc: 'const x = 1;\nconsole.log(x);\n', extensions: [javascript()] });
  assert.equal(collectErrorRanges(syntaxTree(state)).length, 0);
});

test('JS 断代码（const x = ;）：有 error 区间', () => {
  const state = EditorState.create({ doc: 'const x = ;\n', extensions: [javascript()] });
  const ranges = collectErrorRanges(syntaxTree(state));
  assert.ok(ranges.length >= 1);
});

test('JS 断代码：error 区间有效（在文档内且不反向）', () => {
  const state = EditorState.create({ doc: 'const x = ;\n', extensions: [javascript()] });
  const ranges = collectErrorRanges(syntaxTree(state));
  const len = state.doc.length;
  assert.ok(ranges.length >= 1);
  for (const r of ranges) {
    assert.ok(r.from >= 0 && r.from <= r.to && r.to <= len);
  }
});

test('HTML 未闭合标签：有 error 区间', () => {
  const state = EditorState.create({ doc: '<div><span></div>', extensions: [html()] });
  assert.ok(collectErrorRanges(syntaxTree(state)).length >= 1);
});

test('无语言扩展（.md 未加载解析器）：零 error 区间（不误报）', () => {
  const state = EditorState.create({ doc: 'hello world\nplain text' });
  assert.equal(collectErrorRanges(syntaxTree(state)).length, 0);
});
