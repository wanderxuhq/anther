// web/src/editor/diff.test.ts
// DOM 无关验证：StreamLanguage.define(diff) 对 unified diff 文本的解析。
// legacy-modes diff 模式产出 token：'+'→inserted、'-'→deleted、'@'→meta（实测语法树节点名小写）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { diffLanguage } from './diff.ts';

test('diffLanguage：unified diff 文本解析出 inserted/deleted/meta 节点，且树完整覆盖文档', () => {
  const doc = '+added line\n-removed line\n@@ -1,2 +1,2 @@\n context\n';
  const state = EditorState.create({ doc, extensions: [diffLanguage()] });
  const tree = syntaxTree(state).toString();
  assert.match(tree, /inserted/);
  assert.match(tree, /deleted/);
  assert.match(tree, /meta/);
  assert.equal(syntaxTree(state).length, doc.length);
});
