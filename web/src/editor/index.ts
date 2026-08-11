// web/src/editor/index.ts
// CodeMirror 6 适配层：createEditor(container, opts) → EditorHandle。
//
// 两处对 brief 参考代码的有意偏离（详见 task-13-report.md）：
// 1. updateListener 只对「用户输入产生的 doc 变更」触发 onChange：
//    isUserEvent 前缀匹配（'input.type.compose'、'input.paste' 等均命中），
//    程序性 dispatch（setDoc 切换文件、Compartment reconfigure）不带 userEvent，
//    天然跳过——否则 setDoc 会触发无谓保存，并在切换文件时 clearTimeout 掉
//    旧文件 pending 的保存 timer（编辑丢失，数据丢失级缺陷）。
// 2. setDoc 用 setState 重建 state（而非 dispatch changes）：新 state 的 undo 历史
//    为空，防止切换文件后 Ctrl+Z 把上一文件的旧内容写回新文件（配合本层的
//    undo/redo 也算用户编辑、会触发 onChange 的设计，可避免旧内容被保存）。
import { EditorState, Compartment, type Transaction, type Extension } from '@codemirror/state';
import { search, openSearchPanel, closeSearchPanel } from '@codemirror/search';
import { EditorView, basicSetup } from 'codemirror';
import { linter, lintGutter } from '@codemirror/lint';
import { startCompletion } from '@codemirror/autocomplete';
import { parseErrorLinter } from './lint.ts';
import { lspExtension } from './lsp.ts';
import { pathToLanguageId } from './lsp-client.ts';

export type EditorHandle = {
  setReadOnly(r: boolean): void;
  setDoc(doc: string, path?: string | null): void;   // path 缺省/null → 清 LSP（关标签/空文档）
  setLanguage(ext: Extension | null): void;
  openSearch(): void;
  startCompletion(): void;
  gotoLine(line0: number): void;
  destroy(): void;
};

export type EditorOptions = {
  initialDoc: string;
  readOnly: boolean;
  path: string | null;
  onChange: (doc: string) => void;
  onLspNotice?: (msg: string, kind: 'success' | 'error') => void;
};

const editableCompartment = new Compartment();
const languageCompartment = new Compartment();

/**
 * 是否为「用户编辑」产生的事务。对已安装的 CodeMirror 包 grep 全量 userEvent
 * 值验证：会改动 doc 的事件前缀为 input / delete / move / indent / undo / redo；
 * select.* 只改选区不改 doc（外层另有 u.docChanged 守卫）。isUserEvent 做前缀
 * 匹配，故 input.type / input.paste / input.drop / input.complete / input.replace
 * / delete.cut / move.line / move.character / indent 等全部命中。
 */
function isUserEdit(t: Transaction): boolean {
  return (
    t.isUserEvent('input') ||
    t.isUserEvent('delete') ||
    t.isUserEvent('move') ||
    t.isUserEvent('indent') ||
    t.isUserEvent('undo') ||
    t.isUserEvent('redo')
  );
}

export function createEditor(container: HTMLElement, opts: EditorOptions): EditorHandle {
  // setDoc 时用 makeState 重建 state：undo 历史随新 state 清空，且不触发 onChange
  // （setState 产生的 update 无 transactions，some(isUserEdit) 为 false）。
  let currentPath = opts.path ?? null;
  const makeState = (doc: string, readOnly: boolean) => {
    const langId = currentPath ? pathToLanguageId(currentPath) : null;
    const lspOn = langId !== null && !readOnly;
    const lsp = lspOn ? lspExtension(currentPath!, opts.onLspNotice) : null;
    return EditorState.create({
      doc,
      extensions: [
        basicSetup,
        languageCompartment.of([]),
        lintGutter(),
        search(),
        editableCompartment.of([
          // 两个 facet 一起设：EditorState.readOnly 供 undo/redo 等命令判定
          // （只检查 state.readOnly，不检查 editable）；EditorView.editable 管
          // 视觉/输入。只设 editable 时 Mod-z/Mod-y 在只读模式仍会改文档（F1）。
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          // LSP 开启 → 类型诊断 linter（延迟 0）；关闭 → 语法级 parseErrorLinter（延迟 300）。
          // 放进 editableCompartment：只读切换整组重配 → ViewPlugin 销毁/重建，
          // 天然触发 LSP close/open（重连后 onOpen 重发 open 幂等恢复）。
          linter(lsp ? lsp.lintSource : parseErrorLinter, { delay: lsp ? 0 : 300 }),
          ...(lsp ? [lsp.extension] : []),
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && u.transactions.some(isUserEdit)) {
            opts.onChange(u.state.doc.toString());
          }
        }),
      ],
    });
  };

  const view = new EditorView({
    state: makeState(opts.initialDoc, opts.readOnly),
    parent: container,
  });

  return {
    setReadOnly(r: boolean) {
      // 与 makeState 相同的 lsp 计算（闭包读 currentPath/opts.onLspNotice）：
      // 整组重配 editableCompartment，使 LSP ViewPlugin 销毁/重建 → close/open 天然触发
      const langId = currentPath ? pathToLanguageId(currentPath) : null;
      const lspOn = langId !== null && !r;
      const lsp = lspOn ? lspExtension(currentPath!, opts.onLspNotice) : null;
      view.dispatch({
        effects: editableCompartment.reconfigure([
          EditorState.readOnly.of(r),
          EditorView.editable.of(!r),
          linter(lsp ? lsp.lintSource : parseErrorLinter, { delay: lsp ? 0 : 300 }),
          ...(lsp ? [lsp.extension] : []),
        ]),
      });
      // 只读门控（Task 17）：6.7.1 的 replaceNext/replaceAll 已检查 state.readOnly
      // （只读时替换区整个不渲染），closeSearchPanel 作为纵深防御 + VS Code 式
      // UX——只读文件不显示替换面板（内部 togglePanel effect 不导出，无公开关闭
      // 替换区的 API，故关掉整个面板）
      if (r) closeSearchPanel(view);
    },
    openSearch() {
      openSearchPanel(view);
    },
    startCompletion() {
      // 语言异步加载完成前调用 → CM 内部安全 no-op
      startCompletion(view);
    },
    gotoLine(line0: number) {
      // line0 为 0 基行号；行号越界钳制到文档首/末行
      const lineNo = Math.min(Math.max(1, line0 + 1), view.state.doc.lines);
      const line = view.state.doc.line(lineNo);
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
      view.focus();
    },
    setDoc(doc: string, path?: string | null) {
      // path 缺省/null → 清 LSP（关标签/空文档）；makeState 的第二个参数是 readOnly；
      // 读 EditorView.editable 会把布尔值反相（只读时 editable=false → 重建出可编辑 state）。
      // 改用 EditorState.readOnly。
      currentPath = path ?? null; // 切换文件/关标签 → 更新 LSP 目标路径
      view.setState(makeState(doc, view.state.facet(EditorState.readOnly)));
    },
    setLanguage(ext: Extension | null) {
      view.dispatch({
        effects: languageCompartment.reconfigure(ext ? [ext] : []),
      });
    },
    destroy() {
      view.destroy();
    },
  };
}
