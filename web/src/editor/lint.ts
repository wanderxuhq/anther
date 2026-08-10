// web/src/editor/lint.ts
// 语法错误红线：遍历 CodeMirror 语法树找 lezer error 节点 → lint Diagnostic[]。
// 与具体语言包解耦（全靠 node.type.isError），collectErrorRanges 为纯函数便于 node --test 直测。
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import type { Diagnostic } from '@codemirror/lint';

export type ErrorRange = { from: number; to: number };

/** 收集语法树中全部 isError 节点区间。纯函数，可脱离 EditorView 直测。 */
export function collectErrorRanges(tree: ReturnType<typeof syntaxTree>): ErrorRange[] {
  const out: ErrorRange[] = [];
  tree.iterate({ enter(n) { if (n.type.isError) out.push({ from: n.from, to: n.to }); } });
  return out;
}

/**
 * linter source：syntaxTree(state) → Diagnostic[]。全为 error 级。
 * try/catch 防御：linter 回调异常会被 CM 静默，此处兜底返回空数组。
 */
export function parseErrorLinter(view: EditorView): Diagnostic[] {
  try {
    return collectErrorRanges(syntaxTree(view.state)).map((r) => ({
      from: r.from,
      to: r.to,
      severity: 'error',
      message: 'Syntax error',
    }));
  } catch {
    return [];
  }
}
