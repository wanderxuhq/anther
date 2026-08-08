// web/src/api.test.ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, getUserId } from './api.ts';

// Node 无 localStorage —— 用内存桩（测试前全局注入）
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

let fetchCalls: { url: string; init: RequestInit }[] = [];

function mockFetch(status: number, body: unknown) {
  (globalThis as Record<string, unknown>).fetch = async (
    url: string,
    init: RequestInit = {},
  ) => {
    fetchCalls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
}

beforeEach(() => {
  store.clear();
  fetchCalls = [];
});

test('readFile 返回内容', async () => {
  mockFetch(200, { content: 'hi' });
  const r = await api.readFile('a.ts');
  assert.equal(r.content, 'hi');
});

test('非 2xx 抛 ApiError 携带状态码', async () => {
  mockFetch(403, { error: 'read-only' });
  await assert.rejects(api.writeFile('a.ts', 'x', true), (e: Error & { status?: number }) => e.status === 403);
});

test('writeFile 带 ro 参数与 x-user-id 头', async () => {
  mockFetch(200, {});
  await api.writeFile('a.ts', 'x', false);
  const [call] = fetchCalls;
  assert.ok(call.url.includes('ro=0'));
  assert.ok((call.init.headers as Record<string, string>)['x-user-id']);
});

test('getUserId 生成并持久化', () => {
  const id1 = getUserId();
  const id2 = getUserId();
  assert.equal(id1, id2); // 二次读取同一值
  assert.ok(id1.length > 10);
});
