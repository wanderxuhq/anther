// web/src/editor/lsp-client.ts
// LSP WS 客户端（每文档一条连接，重连后 onOpen 重发 open 幂等恢复）+ 转换纯函数。
// JS 字符串索引天然 = UTF-16 码元 → LSP position 直接映射，无需逐字符换算。
import type { Completion } from '@codemirror/autocomplete';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';

export type Position = { line: number; character: number };
export type LspDiagnostic = {
  range: { start: Position; end: Position };
  severity?: number; message: string; code?: string | number;
};
export type LspCompletionItem = {
  label: string; kind?: number; detail?: string;
  documentation?: string | { value: string };
};

export type LspHandlers = {
  onOpen: () => void;
  onDiagnostics: (uri: string, diags: LspDiagnostic[]) => void;
  onUnavailable: (reason: string) => void;
  onRestarted: () => void;
};

export type LspSocket = {
  open(path: string, text: string): void;
  change(path: string, text: string): void;
  close(path: string): void;
  completion(path: string, line: number, character: number, text: string): Promise<LspCompletionItem[]>;
  dispose(): void;
};

export function pathToLanguageId(p: string): string | null {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx' ? 'typescript' : null;
}

export function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') { line++; lineStart = i + 1; }
  }
  return { line, character: offset - lineStart };
}

export function positionToOffset(text: string, pos: Position): number {
  let line = 0;
  let off = 0;
  // 走到目标行的行首
  while (line < pos.line && off < text.length) {
    const nl = text.indexOf('\n', off);
    if (nl === -1) break; // 已无更多行：停在文档末尾
    off = nl + 1;
    line++;
  }
  // 越界钳制到「行尾」而非 doc 边界：过期诊断不横跨后续行
  const nl = text.indexOf('\n', off);
  const lineEnd = nl === -1 ? text.length : nl;
  return Math.min(off + pos.character, lineEnd);
}

const KIND_TO_CM: Record<number, NonNullable<Completion['type']>> = {
  1: 'text', 2: 'method', 3: 'function', 4: 'constructor', 5: 'field', 6: 'variable',
  7: 'class', 8: 'interface', 9: 'module', 10: 'property', 11: 'unit', 12: 'value',
  13: 'enum', 14: 'keyword', 15: 'snippet', 16: 'color', 17: 'file', 18: 'reference',
  19: 'folder', 20: 'enumMember', 21: 'constant', 22: 'struct', 23: 'event',
  24: 'operator', 25: 'typeParameter',
};

export function completionItemToCm(item: LspCompletionItem): Completion {
  const doc =
    typeof item.documentation === 'string'
      ? item.documentation
      : item.documentation && typeof item.documentation === 'object'
        ? item.documentation.value
        : undefined;
  return {
    label: item.label,
    type: KIND_TO_CM[item.kind ?? 0] ?? 'text',
    detail: item.detail,
    info: doc,
    apply: item.label,
  };
}

export function diagnosticToCm(d: LspDiagnostic, text: string): CmDiagnostic {
  return {
    from: positionToOffset(text, d.range.start),
    to: positionToOffset(text, d.range.end),
    severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
    message: d.message,
  };
}

// ---- WS 传输（每文档一条连接；模式对齐 connectTerminal：指数退避重连 + onOpen 恢复） ----

export function connectLsp(handlers: LspHandlers): LspSocket {
  let ws: WebSocket | null = null;
  let disposed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: LspCompletionItem[]) => void; reject: (e: Error) => void }>();

  const sendRaw = (obj: unknown) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };
  const respond = (obj: Record<string, unknown>) => {
    sendRaw(obj);
    return obj;
  };

  const open = () => {
    if (disposed) return;
    ws = new WebSocket(`/api/lsp`);
    ws.onopen = () => { attempt = 0; handlers.onOpen(); };
    ws.onmessage = (e) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (typeof msg.id === 'number') {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.ok) p.resolve(Array.isArray(msg.items) ? (msg.items as LspCompletionItem[]) : []);
          else p.reject(new Error(typeof msg.error === 'string' ? msg.error : 'lsp request failed'));
        }
        return;
      }
      if (msg.type === 'diagnostics' && typeof msg.uri === 'string' && Array.isArray(msg.diagnostics)) {
        handlers.onDiagnostics(msg.uri, msg.diagnostics as LspDiagnostic[]);
      } else if (msg.type === 'restarted') {
        handlers.onRestarted();
      } else if (msg.type === 'unavailable') {
        handlers.onUnavailable(typeof msg.reason === 'string' ? msg.reason : 'language server unavailable');
      }
    };
    ws.onclose = () => {
      ws = null;
      for (const p of pending.values()) p.reject(new Error('lsp connection closed'));
      pending.clear();
      if (disposed) return;
      const delay = Math.min(500 * 2 ** attempt, 8000);
      attempt += 1;
      timer = setTimeout(open, delay);
    };
    ws.onerror = () => { /* onclose 接管重连 */ };
  };
  open();

  return {
    open: (path, text) => sendRaw({ method: 'open', params: { path, text } }),
    change: (path, text) => sendRaw({ method: 'change', params: { path, text } }),
    close: (path) => sendRaw({ method: 'close', params: { path } }),
    completion: (path, line, character, text) => {
      const id = nextId++;
      if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve([]);
      return new Promise<LspCompletionItem[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws!.send(JSON.stringify({ id, method: 'completion', params: { path, line, character, text } }));
      });
    },
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      pending.clear();
      ws?.close();
    },
  };
}
