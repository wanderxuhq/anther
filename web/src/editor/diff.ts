// web/src/editor/diff.ts
// git-diff 渲染适配层：复用 createEditor 只读模式，语言 = legacy-modes diff 流式模式。
// StreamLanguage.define(diff) 返回标准 CM6 Extension，经 languageCompartment 注入，
// 与编辑器其他语言同一套机制（无语法不一致）。
import { StreamLanguage } from '@codemirror/language';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import type { Extension } from '@codemirror/state';
import { createEditor, type EditorHandle } from './index.ts';

export function diffLanguage(): Extension {
  return StreamLanguage.define(diff);
}

export type DiffHandle = EditorHandle;

/** 只读 CodeMirror 渲染 unified diff 文本；onChange noop（只读模式不会触发用户编辑） */
export function createDiffEditor(container: HTMLElement, doc: string): DiffHandle {
  const handle = createEditor(container, { initialDoc: doc, readOnly: true, onChange: () => {} });
  handle.setLanguage(diffLanguage());
  return handle;
}
