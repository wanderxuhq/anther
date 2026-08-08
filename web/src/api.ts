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
};

export type DirEntry = { name: string; type: 'file' | 'dir' | 'link'; size: number; mtime: number };

export type SearchMatch = { line: number; col: number; text: string };
export type SearchFile = { path: string; matches: SearchMatch[] };
export type SearchDone = { truncated: boolean; fileCount: number; matchCount: number };

/**
 * 全局搜索 SSE 客户端（Task 17）：fetch + ReadableStream 逐行解析 `data:` 帧，
 * 按 type 分发 file/done/error。返回 { cancel() }：取消后服务端收到断开即停止遍历。
 * 主动取消（abort）静默——不触发 onError；非 2xx 与解析错误走 onError。
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
              handlers.onDone({ truncated: !!evt.truncated, fileCount: evt.fileCount ?? 0, matchCount: evt.matchCount ?? 0 });
            } else if (evt.type === 'error') {
              handlers.onError(evt.message ?? 'search failed');
            }
          } catch { /* 跳过畸形帧 */ }
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) return; // 主动取消 → 静默
      handlers.onError((e as Error).message);
    }
  })();
  return { cancel: () => ctrl.abort() };
}
