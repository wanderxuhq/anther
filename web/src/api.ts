// web/src/api.ts
const USER_KEY = 'anther:userId';
const TABS_KEY = 'anther:tabsSnapshot';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getUserId(): string {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    // 不用 crypto.randomUUID：非安全上下文（http://<IP> 非 localhost）下不可用
    // （secure context 专属），直接 Math.random 生成 v4 格式 ID。
    // 用户 ID 仅本地标识用途，无需密码学强度，冲突概率可忽略。
    id = fallbackUuid();
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

/** v4 格式 UUID（RFC 4122 位布局；Math.random 实现，避免 secure context 依赖） */
export function fallbackUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function saveTabsSnapshot(paths: string[]): void {
  localStorage.setItem(TABS_KEY, JSON.stringify(paths));
}
export function loadTabsSnapshot(): string[] | null {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': getUserId(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export type GitChange = { path: string; status: string };
export type GitStatus = { isRepo: boolean; changes: GitChange[] };
export type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string };
export type GitBranch = { name: string; current: boolean; tip: string };
export type GitBranches = { isRepo: boolean; current: string | null; branches: GitBranch[] };
export type GitLog = { isRepo: boolean; commits: GitCommit[] };
export type GitShow = { commit: GitCommit; diff: string };

export const api = {
  list: (path: string) => request<{ entries: DirEntry[] }>('GET', `/api/list?path=${encodeURIComponent(path)}`),
  readFile: (path: string) => request<{ content: string; utf8: boolean }>('GET', `/api/file?path=${encodeURIComponent(path)}`),
  writeFile: (path: string, content: string, ro: boolean) =>
    request('PUT', `/api/file?path=${encodeURIComponent(path)}&ro=${ro ? '1' : '0'}`, { content }),
  mkDir: (path: string, ro: boolean) => request('POST', `/api/mkdir?ro=${ro ? '1' : '0'}`, { path }),
  create: (path: string, ro: boolean) => request('POST', `/api/create?ro=${ro ? '1' : '0'}`, { path }),
  rename: (path: string, to: string, ro: boolean) =>
    request('POST', `/api/rename?ro=${ro ? '1' : '0'}`, { path, to }),
  del: (path: string, ro: boolean) => request('POST', `/api/delete?ro=${ro ? '1' : '0'}`, { path }),
  tabs: {
    list: () => request<{ tabs: string[] }>('GET', '/api/tabs'),
    open: (path: string) => request('PUT', '/api/tabs/open', { path }),
    close: (path: string) => request('PUT', '/api/tabs/close', { path }),
    front: (path: string) => request('PUT', '/api/tabs/front', { path }),
    restore: (paths: string[]) => request<{ restored: boolean }>('PUT', '/api/tabs/restore', { paths }),
    heartbeat: () => request('PUT', '/api/heartbeat'),
  },
  terminals: {
    list: () => request<{ terminals: TerminalInfo[] }>('GET', '/api/terminals'),
    create: (name: string) => request<TerminalInfo>('POST', '/api/terminals', { name }),
    close: (id: string) => request('POST', '/api/terminals/close', { id }),
  },
  git: {
    status: () => request<GitStatus>('GET', '/api/git/status'),
    diff: (path: string) => request<{ diff: string }>('GET', `/api/git/diff?path=${encodeURIComponent(path)}`),
    commit: (paths: string[], message: string) => request('POST', '/api/git/commit', { paths, message }),
    branches: () => request<GitBranches>('GET', '/api/git/branches'),
    log: (params: { branch?: string; limit?: number; skip?: number }) => {
      const q = new URLSearchParams();
      if (params.branch) q.set('branch', params.branch);
      q.set('limit', String(params.limit ?? 50));
      q.set('skip', String(params.skip ?? 0));
      return request<GitLog>('GET', `/api/git/log?${q}`);
    },
    show: (commit: string) => request<GitShow>('GET', `/api/git/show?commit=${encodeURIComponent(commit)}`),
    checkout: (name: string) => request<{ current: string }>('POST', '/api/git/checkout', { name }),
    createBranch: (name: string) => request<{ current: string }>('POST', '/api/git/create-branch', { name }),
  },
};

export type DirEntry = { name: string; type: 'file' | 'dir' | 'link'; size: number; mtime: number };

export type SearchMatch = { line: number; col: number; text: string };
export type SearchFile = { path: string; matches: SearchMatch[] };
export type SearchDone = { truncated: boolean; fileCount: number; matchCount: number };

/**
 * 全局搜索 SSE 客户端（Task 17）：fetch + ReadableStream 逐行解析 `data:` 帧，
 * 按 type 分发 file/done/error。返回 { cancel() }：取消后服务端收到断开即停止遍历。
 * 主动取消（abort）静默——不触发 onError；非 2xx 与解析错误走 onError；
 * 流异常中断（EOF 但无 done 帧，如服务端被 kill/代理断连）→ onError('搜索连接中断')。
 */
export function searchStream(
  params: { q: string; caseSensitive?: boolean; exclude?: string },
  handlers: { onFile: (f: SearchFile) => void; onDone: (d: SearchDone) => void; onError: (message: string) => void },
): { cancel(): void } {
  const ctrl = new AbortController();
  const query = new URLSearchParams({ q: params.q, case: params.caseSensitive ? '1' : '0' });
  if (params.exclude) query.set('exclude', params.exclude);
  void (async () => {
    try {
      const res = await fetch(`/api/search?${query}`, {
        headers: { 'x-user-id': getUserId() },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let msg = res.statusText;
        try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ }
        handlers.onError(msg);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // 只有收到 SSE done 事件帧才算正常收尾；流 EOF（读循环的 done）不算
      let sawDone = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim()) as {
              type: string; message?: string; truncated?: boolean;
              fileCount?: number; matchCount?: number;
              path?: string; matches?: SearchMatch[];
            };
            if (evt.type === 'file' && evt.path) {
              handlers.onFile({ path: evt.path, matches: evt.matches ?? [] });
            } else if (evt.type === 'done') {
              sawDone = true;
              handlers.onDone({ truncated: !!evt.truncated, fileCount: evt.fileCount ?? 0, matchCount: evt.matchCount ?? 0 });
            } else if (evt.type === 'error') {
              handlers.onError(evt.message ?? 'search failed');
            }
          } catch { /* 跳过畸形帧 */ }
        }
      }
      // 干净 EOF 但无 done 帧（服务端被 kill/代理断连）：onDone/onError 都不触发，
      // UI 会永久「搜索中…」，这里补一个断连提示（主动取消已由 catch 静默处理）
      if (!sawDone && !ctrl.signal.aborted) handlers.onError('搜索连接中断');
    } catch (e) {
      if (ctrl.signal.aborted) return; // 主动取消 → 静默
      handlers.onError((e as Error).message);
    }
  })();
  return { cancel: () => ctrl.abort() };
}

export type TerminalInfo = { id: string; name: string };

export type TerminalHandlers = {
  /** 每次 WS 打开（含重连）：前端清屏，等服务端历史重放重建画面 */
  onOpen: () => void;
  onOutput: (data: string) => void;
  /** 终端进程退出 / id 失效（4404）→ 前端移除标签 */
  onExit: (code: number) => void;
};

export type TerminalSocket = {
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  dispose: () => void;
};

/**
 * 终端 WS 客户端：自动重连（指数退避 500ms → 8s）。浏览器 WebSocket 不能带
 * 自定义 header → userId 走 ?user= 查询参数（服务端与 x-user-id 同值校验）。
 * 收到 exit 帧或服务端 4404（终端不存在/被删）→ 不再重连，回调 onExit。
 */
export function connectTerminal(id: string, handlers: TerminalHandlers, urlOverride?: string): TerminalSocket {
  const user = getUserId();
  let ws: WebSocket | null = null;
  let pending: string[] = [];
  let disposed = false;
  let dead = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (obj: { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number }) => {
    const frame = JSON.stringify(obj);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
    else if (ws && ws.readyState === WebSocket.CONNECTING) pending.push(frame);
    // CLOSED/null → 丢弃：重连后历史重放覆盖
  };

  const open = () => {
    if (disposed || dead) return;
    ws = new WebSocket(urlOverride ?? `/api/terminal?term=${encodeURIComponent(id)}&user=${encodeURIComponent(user)}`);
    ws.onopen = () => {
      attempt = 0;
      const q = pending; pending = [];   // 先 flush 排队的 resize/input
      for (const f of q) ws!.send(f);
      handlers.onOpen();                 // 再清屏等服务端历史重放
    };
    ws.onmessage = (e) => {
      let msg: { type?: string; data?: string; code?: number };
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (msg.type === 'output' && typeof msg.data === 'string') handlers.onOutput(msg.data);
      else if (msg.type === 'exit') { dead = true; handlers.onExit(typeof msg.code === 'number' ? msg.code : 0); }
    };
    ws.onclose = (e) => {
      ws = null;
      if (disposed || dead) return;
      if (e.code === 4404) { dead = true; handlers.onExit(1); return; } // 终端已不存在/被删
      const delay = Math.min(500 * 2 ** attempt, 8000);
      attempt += 1;
      timer = setTimeout(open, delay);
    };
    ws.onerror = () => { /* 由 onclose 接管重连 */ };
  };
  open();

  return {
    input: (data) => send({ type: 'input', data }),
    resize: (cols, rows) => send({ type: 'resize', cols, rows }),
    dispose: () => { disposed = true; clearTimeout(timer); pending = []; ws?.close(); },
  };
}
