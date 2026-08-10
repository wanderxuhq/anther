// web/src/editor/inline-diff.ts
// 行内 diff 专用 CM6 编辑器：双 gutter（状态栏 + 新文件行号）+ 行级红绿背景。
// 不走 createEditor/basicSetup —— 需替换默认行号；只读静态文档，装饰一次构建，无增量更新。
// 对 brief 代码的两处 API 适配（@codemirror/view@6.43.8）：gutter lineMarker 的 BlockInfo
// 无 number 属性，改用 view.state.doc.lineAt(line.from).number；Decoration.set 返回
// DecorationSet 非 Extension，须经 EditorView.decorations.of 提供。逻辑与结构不变。
import { EditorState, type Range } from '@codemirror/state';
import {
  EditorView, Decoration, GutterMarker, gutter, keymap,
  highlightSpecialChars, drawSelection, dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { buildInlineDoc, type DiffFile } from '../views/diff-model.ts';
import type { EditorHandle } from './index.ts';

export type DiffHandle = EditorHandle; // 复用既有 EditorHandle 接口

class DiffMarker extends GutterMarker {
  constructor(private text: string, private cls = '') {
    super();
  }
  toDOM() {
    const el = document.createElement('span');
    el.textContent = this.text;
    if (this.cls) el.className = this.cls;
    return el;
  }
}

/** 行内 diff 编辑器：状态栏（+/−/空）+ 新文件行号双 gutter + 行级红绿背景。返回 EditorHandle（只读无操作 + 搜索）。 */
export function createInlineDiffEditor(container: HTMLElement, file: DiffFile): DiffHandle {
  const { doc, kinds, numbers } = buildInlineDoc(file);
  const lineCount = doc === '' ? 0 : doc.split('\n').length;

  // 最左状态栏：+（add，绿）/ −（del，红）/ 空（ctx）
  const statusGutter = gutter({
    class: 'cm-diff-status',
    lineMarker(view, line) {
      const kind = kinds[view.state.doc.lineAt(line.from).number - 1] ?? 'ctx';
      if (kind === 'add') return new DiffMarker('+', 'diff-status-add');
      if (kind === 'del') return new DiffMarker('−', 'diff-status-del');
      return new DiffMarker('');
    },
    initialSpacer: () => new DiffMarker('+'),
  });

  // 行号栏：ctx/add 显示新文件行号；del 行空。spacer 按最大行号定宽（右对齐）
  const maxNum = numbers.reduce<number>((m, n) => (n != null ? Math.max(m, n) : m), 1);
  const numberGutter = gutter({
    class: 'cm-diff-numbers',
    lineMarker(view, line) {
      const n = numbers[view.state.doc.lineAt(line.from).number - 1];
      return n == null ? new DiffMarker('') : new DiffMarker(String(n));
    },
    initialSpacer: () => new DiffMarker('9'.repeat(String(maxNum).length)),
  });

  // 行级红绿背景：静态文档，一次构建 RangeSet（Decoration.line 锚行首）
  const ranges: Range<Decoration>[] = [];
  {
    let from = 0;
    for (let i = 0; i < lineCount; i++) {
      const kind = kinds[i];
      if (kind === 'del' || kind === 'add') {
        ranges.push(Decoration.line({ class: kind === 'del' ? 'diff-del' : 'diff-add' }).range(from));
      }
      const nl = doc.indexOf('\n', from);
      from = nl === -1 ? doc.length : nl + 1;
    }
  }

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc,
      extensions: [
        // 编辑无关能力：特殊字符/选区/拖拽光标/历史/按键（readOnly 下无副作用）+ 搜索
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        history(),
        keymap.of([...defaultKeymap, ...searchKeymap]),
        search(),
        statusGutter,
        numberGutter,
        EditorView.decorations.of(Decoration.set(ranges, true)),
        // 只读双 facet 门控（对齐 editor/index.ts）：readOnly 挡命令，editable 挡视觉/输入
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    }),
  });

  return {
    setReadOnly() {},
    setDoc() {},
    setLanguage() {},
    openSearch() { openSearchPanel(view); },
    startCompletion() {}, // 只读静态 diff，无补全
    gotoLine() {},
    destroy() { view.destroy(); },
  };
}
