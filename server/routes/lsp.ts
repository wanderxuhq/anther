// server/routes/lsp.ts
// LSP WebSocket 代理：浏览器 <→ WS JSON 信封 → LspManager → stdio LSP。
// 信封：客户端→服务端 { id?, method: open|change|close|completion, params }；
// 服务端→客户端：响应 { id, ok, items?, error? } 与推送 { type: diagnostics|restarted|unavailable, ... }。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HttpServer } from '../http.ts';
import type { LspManager } from '../lsp-manager.ts';
import { WebSocket } from 'ws';

export function pathToLanguageId(p: string): string | null {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx' ? 'typescript' : null;
}

export function canonicalUriFor(workspaceRoot: string, relPath: string): string {
  return pathToFileURL(path.resolve(workspaceRoot, relPath)).href;
}

type Conn = { ws: WebSocket; open: Map<string, string> }; // uri → engineId

export function registerLspRoutes(http: HttpServer, manager: LspManager): void {
  const connections = new Set<Conn>();

  const sendJson = (ws: WebSocket, obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  // 诊断扇出：发给打开了该 uri 的所有连接；重放缓存由 manager 已存
  manager.onDiagnostics = (uri, diags) => {
    manager.cacheDiagnostics(uri, diags);
    for (const c of connections) if (c.open.has(uri)) sendJson(c.ws, { type: 'diagnostics', uri, diagnostics: diags });
  };

  // 会话退出：<=MAX_RESTARTS 次 → 通知相关连接重发 open（幂等）；超限 → unavailable
  manager.onSessionExit = (engineId, restartCount) => {
    const type = restartCount <= 3 ? 'restarted' : 'unavailable';
    for (const c of connections) {
      if ([...c.open.values()].includes(engineId)) {
        sendJson(c.ws, { type, engineId, restartCount });
      }
    }
  };

  http.ws('/api/lsp', (ws) => {
    const conn: Conn = { ws, open: new Map() };
    connections.add(conn);

    const respond = (id: number | undefined, obj: Record<string, unknown>) => {
      if (id !== undefined) sendJson(ws, { id, ...obj });
    };
    const engineFor = (p: string): string | null => pathToLanguageId(p);

    const handle = async (method: string, params: Record<string, unknown> | undefined, id: number | undefined) => {
      const p = params ?? {};
      try {
        if (method === 'open') {
          const relPath = String(p.path ?? '');
          const text = String(p.text ?? '');
          const engineId = engineFor(relPath);
          if (!engineId) return respond(id, { ok: true }); // 非 LSP 文件：浏览器不发，防御
          const uri = canonicalUriFor(manager.workspaceRoot, relPath);
          await manager.sessionFor(engineId).open(uri, text, engineId);
          manager.markOpen(engineId, uri);
          conn.open.set(uri, engineId);
          const cached = manager.lastDiagnosticsFor(uri);
          if (cached) sendJson(ws, { type: 'diagnostics', uri, diagnostics: cached }); // 重放
          respond(id, { ok: true });
        } else if (method === 'change') {
          const relPath = String(p.path ?? '');
          const engineId = engineFor(relPath);
          if (!engineId) return respond(id, { ok: true });
          await manager.sessionFor(engineId).change(canonicalUriFor(manager.workspaceRoot, relPath), String(p.text ?? ''));
          respond(id, { ok: true });
        } else if (method === 'close') {
          const relPath = String(p.path ?? '');
          const engineId = engineFor(relPath);
          const uri = canonicalUriFor(manager.workspaceRoot, relPath);
          conn.open.delete(uri);
          if (engineId) {
            manager.markClosed(engineId, uri);
            await manager.sessionFor(engineId).close(uri).catch(() => {}); // 会话已崩则吞掉
          }
          respond(id, { ok: true });
        } else if (method === 'completion') {
          const relPath = String(p.path ?? '');
          const engineId = engineFor(relPath);
          if (!engineId) return respond(id, { ok: false, error: 'unsupported' });
          const items = await manager.sessionFor(engineId).completion(
            canonicalUriFor(manager.workspaceRoot, relPath),
            Number(p.line ?? 0),
            Number(p.character ?? 0),
          );
          respond(id, { ok: true, items });
        } else {
          respond(id, { ok: false, error: `unknown method: ${method}` });
        }
      } catch (e) {
        respond(id, { ok: false, error: (e as Error).message });
      }
    };

    ws.on('message', (raw) => {
      let msg: { id?: number; method?: string; params?: Record<string, unknown> };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (typeof msg.method !== 'string') return;
      void handle(msg.method, msg.params, msg.id);
    });

    ws.on('close', () => {
      // 连接断开：把它持有的 uri 全部 markClosed（否则 tsserver 常驻 + 空闲回收永不触发）
      for (const [uri, engineId] of conn.open) manager.markClosed(engineId, uri);
      conn.open.clear();
      connections.delete(conn);
    });
  });
}
