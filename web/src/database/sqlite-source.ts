import { ApiError, getUserId } from '../api.ts';
import type { DatabaseSource } from './source.ts';
import type { DatabaseRequest } from '../../../server/database-types.ts';

export function createSqliteSource(path: string): DatabaseSource {
  const pending = new Set<AbortController>();
  let disposed = false;
  async function request<T>(body: DatabaseRequest, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (disposed || signal?.aborted) controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    pending.add(controller);
    try {
      const query = new URLSearchParams({ path, request: JSON.stringify(body) });
      const response = await fetch(`/api/database?${query}`, { signal: controller.signal, headers: { 'x-user-id': getUserId() } });
      const text = await response.text();
      let result: unknown;
      try { result = JSON.parse(text); }
      catch {
        throw new ApiError(response.ok ? 502 : response.status,
          `SQLite request failed (HTTP ${response.status}): ${text.trim() ? 'invalid JSON response' : 'empty response'}`);
      }
      if (!response.ok) {
        const error = result && typeof result === 'object' && 'error' in result ? result.error : null;
        throw new ApiError(response.status, typeof error === 'string' ? error : response.statusText);
      }
      if (!result || typeof result !== 'object') throw new ApiError(502, 'SQLite reader returned an invalid response');
      return result as T;
    } finally { pending.delete(controller); signal?.removeEventListener('abort', cancel); }
  }
  return {
    listObjects: (signal) => request({ action: 'objects' }, signal),
    describe: (object, signal) => request({ action: 'describe', object }, signal),
    readRows: (input, signal) => request({ action: 'rows', request: input }, signal),
    dispose() { disposed = true; for (const controller of pending) controller.abort(); pending.clear(); },
  };
}
