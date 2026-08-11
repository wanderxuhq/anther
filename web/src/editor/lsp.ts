// web/src/editor/lsp.ts
// CM6 LSP 扩展：补全 source + 类型诊断 linter + 文档生命周期（open/change/close）。
// 每文档一条 WS 连接（与 connectTerminal 同模式）；linter 源读内部 current 数组，
// onDiagnostics 经 setDiagnostics 推入。过期补全由请求 id 匹配丢弃（lsp-client 层）。
import { ViewPlugin, EditorView } from '@codemirror/view';
import { autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import { linter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { t } from '../i18n.ts';
import {
  connectLsp, completionItemToCm, diagnosticToCm, offsetToPosition,
  type LspSocket,
} from './lsp-client.ts';

export function lspExtension(
  path: string,
  notice?: (msg: string, kind: 'success' | 'error') => void,
): { extension: Extension; lintSource: () => CmDiagnostic[] } {
  let current: CmDiagnostic[] = [];
  let view: EditorView | null = null;
  let socket: LspSocket | null = null;

  const doNotice = (key: string, params: Record<string, string> = {}, kind: 'success' | 'error' = 'error') => {
    if (notice) notice(t(key, params), kind);
  };

  socket = connectLsp({
    // WS 重连后：重发 open（幂等），服务端重放诊断缓存
    onOpen: () => { if (view) socket?.open(path, view.state.doc.toString()); },
    onDiagnostics: (uri, diags) => {
      if (!view) return;
      const text = view.state.doc.toString();
      current = diags.map((d) => diagnosticToCm(d, text));
      view.dispatch(setDiagnostics(view.state, current));
    },
    onUnavailable: (reason) => {
      doNotice('toast.lspUnavailable', { msg: reason });
      current = [];
      if (view) view.dispatch(setDiagnostics(view.state, []));
    },
    onRestarted: () => doNotice('toast.lspRestarted', {}, 'success'),
  });

  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      constructor(private v: EditorView) {
        view = v;
        socket?.open(path, v.state.doc.toString());
      }
      update(u: { docChanged: boolean }) {
        if (!u.docChanged) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          socket?.change(path, this.v.state.doc.toString());
        }, 250);
      }
      destroy() {
        view = null;
        if (this.timer) clearTimeout(this.timer);
        socket?.close(path);
        socket?.dispose();
        socket = null;
      }
    },
  );

  // 光标前单词起点（补全替换范围）；identifier 字符：字母/数字/_/$
  const tokenStart = (text: string, pos: number): number => {
    let i = pos;
    while (i > 0 && /[A-Za-z0-9_$]/.test(text[i - 1])) i--;
    return i;
  };

  const completionSource: CompletionSource = async (ctx) => {
    if (!socket) return null;
    const text = ctx.state.doc.toString();
    const pos = offsetToPosition(text, ctx.pos);
    const items = await socket.completion(path, pos.line, pos.character, text);
    if (items.length === 0) return null;
    return { from: tokenStart(text, ctx.pos), to: ctx.pos, options: items.map(completionItemToCm) };
  };

  return {
    lintSource: () => current,
    extension: [
      autocompletion({ override: [completionSource], activateOnTyping: true }),
      plugin,
    ],
  };
}
