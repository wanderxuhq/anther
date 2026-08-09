// web/src/api.test.ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { api, getUserId, fallbackUuid, searchStream, connectTerminal, type SearchFile } from './api.ts';

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

test('fallbackUuid 生成 v4 格式（非安全上下文降级路径）', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (let i = 0; i < 50; i++) assert.match(fallbackUuid(), re);
  assert.notEqual(fallbackUuid(), fallbackUuid());
});

// ---- searchStream SSE 客户端（Task 17） ----
function mockSse(chunks: string[], status = 200) {
  (globalThis as Record<string, unknown>).fetch = async (_url: string, init: RequestInit = {}) => {
    if (init.signal) (init.signal as AbortSignal).throwIfAborted();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
        c.close();
      },
    });
    return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
  };
}

test('searchStream 解析 file/done 事件（含跨帧拼接）', async () => {
  // 一条完整事件拆成两个 chunk：验证帧缓冲拼接
  // （brief 原 chunk1 末尾带 \n，会把 data: 帧在第 20 字符处截断成畸形行；去掉该 \n，
  //  让整行跨 chunk 边界由帧缓冲拼接——正是本测试要验证的行为）
  const half = JSON.stringify({ type: 'file', path: 'a.txt', matches: [{ line: 1, col: 0, text: 'hello' }] });
  mockSse([`data: ${half.slice(0, 20)}`, `${half.slice(20)}\n\n`, 'data: {"type":"done","truncated":false,"fileCount":1,"matchCount":1}\n\n']);
  const files: SearchFile[] = [];
  await new Promise<void>((resolve) => {
    searchStream({ q: 'hello' }, {
      onFile: (f) => files.push(f),
      onDone: () => resolve(),
      onError: () => resolve(),
    });
  });
  assert.deepEqual(files, [{ path: 'a.txt', matches: [{ line: 1, col: 0, text: 'hello' }] }]);
});

test('searchStream 非 2xx → onError（解析 {error}）', async () => {
  // 带 {error} 响应体：Node 手工构造的 Response statusText 为 ''，且本测试要验证的是 {error} 解析
  mockSse(['{"error":"nf"}'], 404);
  let err = '';
  await new Promise<void>((resolve) => {
    searchStream({ q: 'x' }, { onFile: () => {}, onDone: () => resolve(), onError: (m) => { err = m; resolve(); } });
  });
  assert.ok(err.length > 0);
});

test('searchStream 发送 case/exclude 参数', async () => {
  let url = '';
  (globalThis as Record<string, unknown>).fetch = async (u: string) => {
    url = u;
    // 模拟服务端：body 至少含一条 done 帧，否则 searchStream 不会触发 onDone，promise 永不 resolve
    return new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"type":"done","truncated":false,"fileCount":0,"matchCount":0}\n\n'));
        c.close();
      },
    }), { status: 200 });
  };
  await new Promise<void>((resolve) => {
    searchStream({ q: 'hello', caseSensitive: true, exclude: '.git,x' }, { onFile: () => {}, onDone: () => resolve(), onError: () => resolve() });
  });
  assert.ok(url.includes('case=1'));
  assert.ok(url.includes('exclude=.git%2Cx'));
});

test('searchStream cancel 触发 abort（静默，不触发 onError）', async () => {
  let signal: AbortSignal | undefined;
  (globalThis as Record<string, unknown>).fetch = async (_u: string, init: RequestInit = {}) => {
    signal = init.signal as AbortSignal;
    // 永不 resolve 的流：cancel 后 reader.read() 抛 AbortError，被 catch 静默吞掉
    return new Response(new ReadableStream({ start() {} }), { status: 200 });
  };
  let err = '';
  const { cancel } = searchStream({ q: 'x' }, { onFile: () => {}, onDone: () => {}, onError: (m) => { err = m; } });
  cancel();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(signal?.aborted, true);
  assert.equal(err, '');
});

// ---- connectTerminal WS 客户端（Task 8/11 修复：CONNECTING 发送队列） ----
test('connectTerminal：CONNECTING 期间 input/resize 不抛，open 后帧送达', async () => {
  const received: string[] = [];
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (s) => s.on('message', (d: Buffer) => received.push(d.toString())));
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };

  try {
    const sock = connectTerminal(
      't1',
      { onOpen: () => {}, onOutput: () => {}, onExit: () => {} },
      `ws://127.0.0.1:${port}/api/terminal?term=t1&user=u`, // URL 覆盖（node 不能建相对 URL）
    );
    // 同步立即发：当前代码 readyState=0 → 抛 DOMException → doesNotThrow 红
    assert.doesNotThrow(() => { sock.input('a'); sock.resize(120, 40); });

    await new Promise<void>((r) => setTimeout(r, 150)); // 等 open + flush
    const frames = received.map((f) => JSON.parse(f));
    assert.equal(frames[0]?.type, 'input');
    assert.equal(frames[0]?.data, 'a');
    assert.equal(frames[1]?.type, 'resize');
    assert.equal(frames[1]?.cols, 120);
    assert.equal(frames[1]?.rows, 40);
    sock.dispose();
  } finally {
    wss.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
