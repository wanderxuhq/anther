// server/routes/terminal.ts
// 终端 REST + WebSocket 路由。用户标识：REST 用 x-user-id header；WS 无法带
// 自定义 header → 用 ?user= 查询参数（与 x-user-id 同值）。
// 关闭用 POST /api/terminals/close + body {id}（HttpServer 精确路径匹配无路径
// 参数，与既有 PUT /api/tabs/close {path} 同风格）。
import type { HttpServer } from '../http.ts';
import { HttpError } from '../http-error.ts';
import type { TerminalManager } from '../terminal.ts';
import type { FileStore } from '../files.ts';
import type { RGB, TerminalQueryMeta } from '../terminal-queries.ts';
import { WebSocket } from 'ws';

const userId = (req: import('node:http').IncomingMessage): string => {
  const h = req.headers['x-user-id'];
  return typeof h === 'string' ? h : 'anon';
};

const WS_FORBIDDEN = 4404; // 应用自定义关闭码：终端不存在/不属于该用户

const isRgb = (value: unknown): value is RGB => {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as { r?: unknown; g?: unknown; b?: unknown };
  return [c.r, c.g, c.b].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 255);
};

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export function registerTerminalRoutes(http: HttpServer, terminals: TerminalManager, files?: FileStore): void {
  // 终端输出里的路径 → 工作区文件/目录。cwd 来自 OSC 7（shell 当前目录）。
  http.get('/api/terminal/resolve', async (req) => {
    if (!files) throw new HttpError(404, 'not found');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const raw = url.searchParams.get('path');
    if (!raw) throw new HttpError(400, 'missing path');
    return files.locateTerminalPath(raw, url.searchParams.get('cwd') ?? '');
  });

  http.post('/api/terminals', async (req, body) => {
    // name 由前端本地生成（含本地化）后随请求传入；服务端不命名、不兜底
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const name = (body as { name?: unknown }).name;
    if (typeof name !== 'string') throw new HttpError(400, 'missing name');
    try {
      return await terminals.create(userId(req), name);
    } catch (e) {
      throw new HttpError(400, (e as Error).message || 'failed to start terminal');
    }
  });

  http.get('/api/terminals', async (req) => ({ terminals: terminals.list(userId(req)) }));

  http.post('/api/terminals/close', async (req, body) => {
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'missing body');
    const id = (body as { id?: unknown }).id;
    if (typeof id !== 'string') throw new HttpError(400, 'missing id');
    const user = userId(req);
    if (!terminals.get(user, id)) throw new HttpError(404, 'terminal not found');
    await terminals.close(user, id);
  });

  http.ws('/api/terminal', (ws, _req, query) => {
    const id = query.get('term');
    const user = query.get('user') ?? 'anon';
    const term = id ? terminals.get(user, id) : null;
    if (!term) { ws.close(WS_FORBIDDEN, 'terminal not found'); return; }

    // 先发历史重放（方案 B：xterm 重新执行转义序列恢复画面，不干扰 vim/Claude Code）；
    // 再订阅实时 output。WS 有序保证不串帧；订阅间隙丢的批次都在 history 里，重放已覆盖。
    ws.send(JSON.stringify({ type: 'output', data: term.replay() }));
    const onData = (batch: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'output', data: batch }));
    };
    term.on('output', onData);

    const onExit = (code: number) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code }));
        ws.close();
      }
    };
    term.on('exit', onExit);

    ws.on('close', () => {
      term.off('output', onData);
      term.off('exit', onExit);
    });

    ws.on('message', (raw) => {
      let msg: {
        type?: string; data?: unknown; cols?: unknown; rows?: unknown;
        fg?: unknown; bg?: unknown; cursor?: unknown;
        pixelWidth?: unknown; pixelHeight?: unknown; cellWidth?: unknown; cellHeight?: unknown;
      };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'input' && typeof msg.data === 'string') {
        term.write(msg.data);
      } else if (
        msg.type === 'resize' &&
        typeof msg.cols === 'number' && Number.isInteger(msg.cols) && msg.cols > 0 &&
        typeof msg.rows === 'number' && Number.isInteger(msg.rows) && msg.rows > 0
      ) {
        void term.resize(msg.cols, msg.rows);
      } else if (msg.type === 'meta') {
        const meta: TerminalQueryMeta = {};
        if (isRgb(msg.fg)) meta.fg = msg.fg;
        if (isRgb(msg.bg)) meta.bg = msg.bg;
        if (isRgb(msg.cursor)) meta.cursor = msg.cursor;
        if (isPositive(msg.pixelWidth)) meta.pixelWidth = msg.pixelWidth;
        if (isPositive(msg.pixelHeight)) meta.pixelHeight = msg.pixelHeight;
        if (isPositive(msg.cellWidth)) meta.cellWidth = msg.cellWidth;
        if (isPositive(msg.cellHeight)) meta.cellHeight = msg.cellHeight;
        term.setMeta(meta);
      } else if (msg.type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }));
      }
    });
  });
}
