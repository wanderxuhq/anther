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
import { EditorState, Compartment, type Transaction } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';

export type EditorHandle = {
  setReadOnly(r: boolean): void;
  setDoc(doc: string): void;
  destroy(): void;
};

export type EditorOptions = {
  initialDoc: string;
  readOnly: boolean;
  onChange: (doc: string) => void;
};

const editableCompartment = new Compartment();

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
  const makeState = (doc: string, readOnly: boolean) =>
    EditorState.create({
      doc,
      extensions: [
        basicSetup,
        editableCompartment.of(EditorView.editable.of(!readOnly)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && u.transactions.some(isUserEdit)) {
            opts.onChange(u.state.doc.toString());
          }
        }),
      ],
    });

  const view = new EditorView({
    state: makeState(opts.initialDoc, opts.readOnly),
    parent: container,
  });

  return {
    setReadOnly(r: boolean) {
      view.dispatch({
        effects: editableCompartment.reconfigure(EditorView.editable.of(!r)),
      });
    },
    setDoc(doc: string) {
      view.setState(makeState(doc, view.state.facet(EditorView.editable)));
    },
    destroy() {
      view.destroy();
    },
  };
}
