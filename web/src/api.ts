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
    // 非安全上下文（http://<IP> 非 localhost 访问）下 crypto.randomUUID 不可用
    // （secure context 专属，getRandomValues 同样受限）→ 降级生成 v4 格式 ID。
    // 用户 ID 仅本地标识用途，无需密码学强度，Math.random 冲突概率可忽略。
    id = crypto.randomUUID?.() ?? fallbackUuid();
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

/** v4 格式 UUID 降级实现（RFC 4122 位布局，供非安全上下文） */
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
