// server/http.ts
import { createServer, IncomingMessage, ServerResponse, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { HttpError } from './http-error.ts';

export type Handler = (
  req: IncomingMessage,
  body: unknown,
  query: URLSearchParams,
) => Promise<unknown> | unknown;

export type SseHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  query: URLSearchParams,
) => void | Promise<void>;

export type WsHandler = (
  ws: WebSocket,
  req: IncomingMessage,
  query: URLSearchParams,
) => void | Promise<void>;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** 每个工作区一套路由表；HttpServer 自身是 shell（静态、身份、attach/detach）路由表。 */
export class Router {
  private routes = new Map<string, Map<string, Handler>>();
  private binaryPosts = new Set<string>();
  private sseRoutes = new Map<string, SseHandler>();
  private streamRoutes = new Map<string, SseHandler>();
  private wsRoutes = new Map<string, WsHandler>();
  private wsClients = new Set<WebSocket>();
  private disposers: (() => Promise<void>)[] = [];

  get(pattern: string, h: Handler) { this.add('GET', pattern, h); }
  put(pattern: string, h: Handler) { this.add('PUT', pattern, h); }
  post(pattern: string, h: Handler) { this.add('POST', pattern, h); }

  postBinary(pattern: string, h: Handler) {
    this.binaryPosts.add(pattern);
    this.post(pattern, h);
  }

  sse(pattern: string, h: SseHandler) { this.sseRoutes.set(pattern, h); }

  /** GET / HEAD 原始响应，由路由设置响应头并处理 HEAD 的空响应体。 */
  getStream(pattern: string, h: SseHandler) { this.streamRoutes.set(pattern, h); }

  ws(pattern: string, h: WsHandler) { this.wsRoutes.set(pattern, h); }

  onClose(dispose: () => Promise<void>) { this.disposers.push(dispose); }

  private add(method: string, pattern: string, h: Handler) {
    if (!this.routes.has(method)) this.routes.set(method, new Map());
    this.routes.get(method)!.set(pattern, h);
  }

  handler(method: string, pathname: string): Handler | undefined {
    return this.routes.get(method)?.get(pathname);
  }
  isBinaryPost(pathname: string): boolean { return this.binaryPosts.has(pathname); }
  sseHandler(pathname: string): SseHandler | undefined { return this.sseRoutes.get(pathname); }
  streamHandler(pathname: string): SseHandler | undefined { return this.streamRoutes.get(pathname); }
  wsHandler(pathname: string): WsHandler | undefined { return this.wsRoutes.get(pathname); }

  trackWs(ws: WebSocket): void { this.wsClients.add(ws); }
  untrackWs(ws: WebSocket): void { this.wsClients.delete(ws); }

  async dispose(): Promise<void> {
    // 卸载挂载时只关闭该挂载的 WS（终端/LSP），不影响其他工作区。
    for (const ws of this.wsClients) {
      try { ws.close(); } catch { /* 已关闭 */ }
    }
    this.wsClients.clear();
    await Promise.all(this.disposers.map((dispose) => dispose()));
  }
}

type Resolved = {
  router: Router;
  base: string;
  /** 原始 pathname，用于静态文件查找。 */
  pathname: string;
  /** 去掉挂载前缀后的 pathname，用于路由匹配。 */
  restPath: string;
  /** 去掉挂载前缀后的 pathname + query，写回 req.url，路由无需感知挂载。 */
  restUrl: string;
  search: string;
  reserved: boolean;
};

const requestRouters = new WeakMap<IncomingMessage, Router>();

function normalizeBase(base: string): string {
  if (base === '') return '';
  if (!base.startsWith('/')) throw new Error(`mount base must start with /: ${base}`);
  const trimmed = base.replace(/\/+$/, '');
  return trimmed === '' || trimmed === '/' ? '' : trimmed;
}

/** `/-/` 是挂载命名空间；未注册的 `/-/...` 不能回落到普通文件路径。 */
function reservedRest(restPath: string): boolean {
  return restPath === '/-/' || restPath.startsWith('/-/');
}

function injectBase(html: string, base: string): string {
  // 根路径不注入：前端默认 base 为空，保持既有静态响应完全不变。
  if (!base || html.includes('__ANTHER_BASE__') || !html.includes('</head>')) return html;
  const tag = `<script>window.__ANTHER_BASE__=${JSON.stringify(base)};</script>`;
  return html.replace('</head>', `${tag}</head>`);
}

export class HttpServer extends Router {
  private wss = new WebSocketServer({ noServer: true });
  private server: Server;
  /** 运行中热切换会保留旧监听 server 直到其连接自然结束，关闭时一并收尾。 */
  private servers = new Set<Server>();
  private listenHost = '';
  private rebinding = false;
  private staticDir: string;
  private mounts = new Map<string, Router>();
  private bases: string[] = [];
  /** 宿主工作区路由：挂在 '/' 时作为根路由的 fallback；detach 后为 null。 */
  private rootWorkspace: Router | null = null;
  private hostConfigured = false;
  private hostAttached = false;

  constructor(opts: { staticDir: string }) {
    super();
    this.staticDir = opts.staticDir;
    this.mount('', this);
    this.server = this.createServer();

    // async 守卫：handler 是 void|Promise<void>，.catch 无法直接挂（void 无 .catch）；
    // 用 async 回调 + try/catch，与 SSE 路径（await + catch 写错误）同款。
    this.wss.on('connection', async (ws, req) => {
      const router = requestRouters.get(req) ?? this;
      router.trackWs(ws);
      ws.on('close', () => router.untrackWs(ws));
      const url = new URL(req.url ?? '/', 'http://localhost');
      const h = router.wsHandler(url.pathname);
      try {
        if (h) await h(ws, req, url.searchParams);
        else ws.close();
      } catch (e) {
        console.error(`ws handler ${url.pathname}:`, e);
        ws.close();
      }
    });
  }

  /** 每个监听 server 复用同一套请求/升级处理；热切换时替换的是 server，不是路由。 */
  private createServer(): Server {
    const server = createServer((req, res) => void this.handle(req, res));
    server.on('upgrade', this.handleUpgrade);
    server.on('close', () => this.servers.delete(server));
    this.servers.add(server);
    return server;
  }

  private handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const resolved = this.resolve(req.url ?? '/');
    if (resolved.reserved) {
      socket.destroy();
      return;
    }
    const candidates = resolved.base === '' && this.rootWorkspace && this.rootWorkspace !== resolved.router
      ? [resolved.router, this.rootWorkspace]
      : [resolved.router];
    const router = candidates.find((candidate) => candidate.wsHandler(resolved.restPath));
    if (!router) {
      socket.destroy();
      return;
    }
    requestRouters.set(req, router);
    req.url = resolved.restUrl;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  };

  /** 把一个 Router 挂到一个或多个 URL 前缀；'' 表示宿主根路径。 */
  mount(bases: string | string[], router: Router) {
    for (const raw of Array.isArray(bases) ? bases : [bases]) {
      const base = normalizeBase(raw);
      if (this.mounts.has(base)) throw new Error(`mount already exists: ${base || '/'}`);
      this.mounts.set(base, router);
    }
    this.bases = [...this.mounts.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  }

  /** 设置/清除宿主工作区；宿主 detach 时传 null。 */
  setRootWorkspace(router: Router | null) {
    this.rootWorkspace = router;
    if (router) {
      this.hostConfigured = true;
      this.hostAttached = true;
    } else {
      this.hostAttached = false;
    }
  }

  /** 仅当调用方确实配置过宿主、且宿主已被 detach 时为 true。 */
  private hostDetached(): boolean {
    return this.hostConfigured && !this.hostAttached;
  }

  private redirectToInstances(res: ServerResponse): void {
    res.writeHead(302, { Location: '/-' });
    res.end();
  }

  /** 移除挂载前缀；宿主根路径 '' 不允许卸载。 */
  unmount(bases: string | string[]) {
    for (const raw of Array.isArray(bases) ? bases : [bases]) {
      const base = normalizeBase(raw);
      if (base !== '') this.mounts.delete(base);
    }
    this.bases = [...this.mounts.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  }

  private listenOn(server: Server, port: number, host: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (e: Error) => {
        server.off('listening', onListening);
        reject(e);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  /** 同一端口热切换时，旧监听 socket 释放有极短延迟；对 EADDRINUSE 做短暂重试。 */
  private async listenWithRetry(server: Server, port: number, host: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.listenOn(server, port, host);
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= 100) throw e;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }

  async listen(port: number, host: string) {
    await this.listenOn(this.server, port, host);
    this.listenHost = host;
  }

  listenInfo(): { host: string; port: number } | null {
    const address = this.server.address();
    if (!address || typeof address === 'string') return null;
    return { host: this.listenHost, port: address.port };
  }

  /**
   * 运行中热切换监听地址：只替换监听 socket，不关闭 wss，也不 dispose 路由，
   * 因此已建立的终端/LSP WebSocket 会继续工作。绑定失败时尽力回滚到原地址。
   */
  async rebind(host: string): Promise<{ host: string; port: number }> {
    if (this.rebinding) throw new Error('rebind already in progress');
    this.rebinding = true;
    try {
      const address = this.server.address();
      if (!address || typeof address === 'string') throw new Error('server is not listening');
      const port = address.port;
      const previousHost = this.listenHost;
      if (host === previousHost) return { host, port };
      const next = this.createServer();
      this.server.close(); // 停止接受新连接；已有 HTTP/WS 连接继续由旧 server 服务
      try {
        await this.listenWithRetry(next, port, host);
      } catch (e) {
        // 绑定失败：尽力回到原地址，避免服务完全失去监听。
        this.servers.delete(next);
        const rollback = this.createServer();
        try {
          await this.listenWithRetry(rollback, port, previousHost);
          this.server = rollback;
          this.listenHost = previousHost;
        } catch {
          this.servers.delete(rollback);
        }
        throw e;
      }
      this.server = next;
      this.listenHost = host;
      return { host, port };
    } finally {
      this.rebinding = false;
    }
  }

  async close() {
    for (const c of this.wss.clients) c.close();
    this.wss.close();
    const servers = [...this.servers];
    this.servers.clear();
    await Promise.all(servers.map((server) => {
      if (!server.listening) return Promise.resolve();
      return new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }));
    const routers = new Set<Router>([this, ...this.mounts.values()]);
    if (this.rootWorkspace) routers.add(this.rootWorkspace);
    await Promise.all([...routers].map((router) => router.dispose()));
  }

  address() { return this.server.address(); }

  private resolve(rawUrl: string): Resolved {
    const url = new URL(rawUrl, 'http://localhost');
    const pathname = url.pathname;
    const search = url.search;

    let matched = '';
    for (const base of this.bases) {
      if (pathname === base || pathname.startsWith(`${base}/`)) {
        matched = base;
        break;
      }
    }

    if (matched) {
      const restPath = pathname.slice(matched.length) || '/';
      return {
        router: this.mounts.get(matched)!,
        base: matched,
        pathname,
        restPath,
        restUrl: restPath + search,
        search,
        reserved: reservedRest(restPath),
      };
    }

    // `/-` 和 `/-/` 是实例列表页；其余未注册的 `/-/...` 仍是保留命名空间。
    if (pathname !== '/-/' && reservedRest(pathname)) {
      return { router: this, base: '', pathname, restPath: pathname, restUrl: rawUrl, search, reserved: true };
    }

    return { router: this, base: '', pathname, restPath: pathname, restUrl: rawUrl, search, reserved: false };
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const resolved = this.resolve(req.url ?? '/');
      if (resolved.reserved) {
        // 没有对应 project 的 `/-/...` 导航回项目列表；非 GET/HEAD 仍是 404。
        if (req.method === 'GET' || req.method === 'HEAD') {
          this.redirectToInstances(res);
          return;
        }
        throw new HttpError(404, 'not found');
      }

      req.url = resolved.restUrl;
      const { router, restPath } = resolved;
      const query = new URL(resolved.restUrl, 'http://localhost').searchParams;
      // 根路径的 shell 路由（attach/detach/identity）优先；宿主工作区作为 fallback。
      const candidates = resolved.base === '' && this.rootWorkspace && this.rootWorkspace !== router
        ? [router, this.rootWorkspace]
        : [router];

      if (req.method === 'GET' || req.method === 'HEAD') {
        for (const candidate of candidates) {
          const streamHandler = candidate.streamHandler(restPath);
          if (streamHandler) {
            await streamHandler(req, res, query);
            return;
          }
        }
      }

      // SSE 路由：handler 直接拿 res 写流；错误也写在流里。
      if (req.method === 'GET') {
        for (const candidate of candidates) {
          const sseHandler = candidate.sseHandler(restPath);
          if (sseHandler) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            try {
              await sseHandler(req, res, query);
            } catch (e) {
              if (!res.writableEnded) {
                const msg = e instanceof HttpError ? e.message : 'internal error';
                res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
              }
            }
            if (!res.writableEnded) res.end();
            return;
          }
        }
      }

      let handler: Handler | undefined;
      let handlerRouter: Router | undefined;
      for (const candidate of candidates) {
        handler = candidate.handler(req.method ?? '', restPath);
        if (handler) { handlerRouter = candidate; break; }
      }
      if (!handler) {
        // 未知 API 永远返回 JSON 404，不能落到 SPA fallback。
        if (restPath.startsWith('/api/')) throw new HttpError(404, 'not found');
        if (req.method === 'GET' || req.method === 'HEAD') {
          const instances = resolved.base === '' && (resolved.pathname === '/-' || resolved.pathname === '/-/');
          const redirect = resolved.base === '' && !instances && this.hostDetached();
          await this.serveStatic(resolved.pathname, res, req.method === 'HEAD', resolved.base, redirect);
          return;
        }
        throw new HttpError(404, 'not found');
      }

      const binary = req.method === 'POST' && handlerRouter!.isBinaryPost(restPath);
      const body = await readBody(req, binary);
      const result = await handler(req, body, query);
      res.json(result ?? { ok: true });
    } catch (e: unknown) {
      // 已开始的下载失败或被取消时终止流，不能再追加 JSON 响应。
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) {
        res.json({ error: e.message }, e.status);
      } else {
        res.json({ error: 'internal error' }, 500);
      }
    }
  }

  /** 静态资源 + SPA fallback：存在则返回文件，否则返回 index.html；headOnly 时只发头不发 body */
  private async serveStatic(
    urlPath: string,
    res: ServerResponse,
    headOnly = false,
    base = '',
    redirectToInstances = false,
  ) {
    const shellPath = urlPath === '/' || urlPath === '/index.html';
    if (redirectToInstances && shellPath) {
      this.redirectToInstances(res);
      return;
    }
    let rel: string;
    try {
      rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
    } catch {
      // %zz 等畸形编码 decodeURIComponent 抛 URIError → 400 而非 500
      throw new HttpError(400, 'bad path');
    }
    const abs = path.resolve(this.staticDir, rel);
    if (!abs.startsWith(path.resolve(this.staticDir) + path.sep) && rel !== 'index.html') {
      throw new HttpError(400, 'bad path');
    }
    // Content-Type 按实际读取到的文件决定：fallback 分支返回的是 index.html，
    // 若用请求路径的扩展名（如 .ts）会落到 application/octet-stream → 浏览器把
    // 应用页面当成文件下载
    let content: Buffer;
    let ext: string;
    try {
      content = await readFile(abs);
      ext = path.extname(abs);
    } catch {
      if (redirectToInstances) {
        this.redirectToInstances(res);
        return;
      }
      // SPA fallback：任意路径都回 index.html
      content = await readFile(path.join(this.staticDir, 'index.html'));
      ext = '.html';
    }
    if (ext === '.html') content = Buffer.from(injectBase(content.toString('utf8'), base));
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': content.length,
    });
    res.end(headOnly ? undefined : content);
  }
}

async function readBody(req: IncomingMessage, binary = false): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (!binary && size > 1_000_000) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  if (binary) return Buffer.concat(chunks);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}
