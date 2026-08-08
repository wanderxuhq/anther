# anther 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 anther——移动端优先的浏览器代码查看/编辑工具（文件管理 + CodeMirror 编辑器 + 内存级共享标签 + URL 状态化）。

**Architecture:** 单体 npm 包。后端为 Node 原生 http + TypeScript（零框架依赖），提供文件 API、内存标签 API、静态托管与 SPA fallback；前端为 SolidJS + CodeMirror 6（Vite 构建，产物打包进 npm 包）。服务端零落盘，状态只存在于进程内存（标签列表）与 URL（当前文件 + ro/theme/fs）。

**Tech Stack:** TypeScript (ESM)、Node 原生 `node:http` + `node:test`、SolidJS、CodeMirror 6、Vite、vitest + solid-testing-library（前端测试）。

## Global Constraints

- Node >= 24（`node --test` + TS 类型剥离原生可用；ESM import 必须带 `.ts` 扩展名）
- 后端零运行时依赖（只用 node 内置模块 + 前端构建产物）
- 服务端零落盘：不创建任何配置文件/缓存/日志；不写 cookie
- 客户端不写 localStorage（除两个明确用途：`anther:userId`、`anther:tabsSnapshot`）
- 默认只读：`--rw` 启动参数是写入必要前提，请求 `ro=1` 的写请求 403
- 所有 UI 文案用中文；代码标识符/注释用英文
- URL 协议：`/<path>?ro=1&theme=dark&fs=110`，history 路由，SPA fallback
- 每次任务结束 commit（`git add` 具体文件 + 规范 message）

## 文件结构

```
anther/
├── package.json                # bin 入口、scripts（test/build/dev）、deps
├── tsconfig.json               # NodeNext ESM，strict
├── bin/anther.js               # CLI 纯 JS wrapper → dist/server/cli.js
├── server/
│   ├── http-error.ts           # HttpError 类 + res.json 辅助
│   ├── files.ts                # 文件系统访问层（路径安全、目录穿越防护）
│   ├── write-gate.ts           # 写入校验（--rw + ro 双条件）
│   ├── tab-store.ts            # 内存标签存储（存续规则、心跳超时）
│   ├── http.ts                 # 服务器框架：路由表、JSON body、错误映射、静态托管、SPA fallback
│   ├── routes/
│   │   ├── fs.ts               # 文件 API 路由（list/read/write/mkdir/rename/delete）
│   │   └── tabs.ts             # 标签 API 路由（list/open/close/front/restore/heartbeat）
│   ├── cli.ts                  # 入口：参数解析、组装、启动
│   └── *.test.ts               # node:test 单测与冒烟测试
├── web/
│   ├── index.html
│   ├── vite.config.ts          # dev 代理 /api → :3000；build 输出到 ../dist/web
│   └── src/
│       ├── main.tsx
│       ├── App.tsx             # 布局断点、工具栏、抽屉骨架
│       ├── url-state.ts        # URL parse/serialize 纯函数
│       ├── api.ts              # API 客户端（fetch 封装 + userId）
│       ├── stores.ts           # Solid 信号：当前文件/标签/只读/心跳
│       ├── views/
│       │   ├── registry.ts     # 视图注册表 {id, icon, title, render}
│       │   ├── filetree.tsx    # 文件树视图
│       │   └── tabs.tsx        # 标签列表视图
│       ├── editor/
│       │   └── index.ts        # CodeMirror 适配层
│       └── styles.css          # 布局、dvh、暗色跟随系统
├── dist/                       # 构建产物：server（tsc）+ web（vite）
└── docs/superpowers/specs/2026-08-08-anther-design.md   # 规格（已提交）
```

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`（覆盖现有）
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `server/http-error.ts`
- Create: `server/http-error.test.ts`

**Interfaces:**
- Produces: `HttpError`（供 Task 2-7 使用）；`ServerResponse.prototype.json` 辅助；`npm test` 可运行。

- [ ] **Step 1: 写失败测试**

```ts
// server/http-error.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http-error.ts';

test('HttpError 携带状态码与消息', () => {
  const err = new HttpError(403, 'read-only');
  assert.equal(err.status, 403);
  assert.equal(err.message, 'read-only');
  assert.ok(err instanceof Error);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/`
Expected: FAIL（`Cannot find module './http-error.ts'`）

- [ ] **Step 3: 写 package.json、tsconfig、.gitignore、http-error.ts**

```json
{
  "name": "anther",
  "version": "0.1.0",
  "description": "移动优先的浏览器代码查看/编辑工具",
  "license": "ISC",
  "author": "wanderxuhq",
  "type": "module",
  "bin": { "anther": "./bin/anther.js" },
  "scripts": {
    "test": "node --test server/",
    "test:web": "vitest run --config web/vite.config.ts",
    "dev": "concurrently -k \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "node --watch --experimental-transform-types server/cli.ts",
    "dev:web": "vite --config web/vite.config.ts",
    "build": "tsc -p tsconfig.json && vite build --config web/vite.config.ts",
    "start": "node bin/anther.js"
  },
  "dependencies": {
    "@codemirror/state": "^6",
    "@codemirror/view": "^6",
    "codemirror": "^6",
    "solid-js": "^1.9"
  },
  "devDependencies": {
    "@solidjs/testing-library": "^0.8",
    "@types/node": "^24",
    "concurrently": "^9",
    "jsdom": "^26",
    "typescript": "^5",
    "vite": "^6",
    "vite-plugin-solid": "^2",
    "vitest": "^3"
  }
}
```

```json
// tsconfig.json —— server 用 NodeNext 编译，web 由 vite 独立处理
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist/server",
    "rootDir": "server",
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true
  },
  "include": ["server"]
}
```

```gitignore
node_modules/
dist/
```

```ts
// server/http-error.ts
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// res.json 辅助（挂在原型上，路由层直接用）
import type { ServerResponse } from 'node:http';
declare module 'node:http' {
  interface ServerResponse {
    json(data: unknown, status?: number): void;
  }
}
ServerResponse.prototype.json = function (data: unknown, status = 200) {
  const body = JSON.stringify(data);
  this.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  this.end(body);
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（1 个测试）

- [ ] **Step 5: 提交**

```bash
git add package.json tsconfig.json .gitignore server/http-error.ts server/http-error.test.ts
git commit -m "chore: 项目脚手架（ESM + TS + node:test + HttpError）"
```

---

### Task 2: 文件系统访问层（files.ts）

**Files:**
- Create: `server/files.ts`
- Create: `server/files.test.ts`

**Interfaces:**
- Consumes: `HttpError`（Task 1）
- Produces: `class FileStore`（供 Task 5、7 使用）：
  - `constructor(root: string)`
  - `resolve(relPath: string): string` —— 规范化并校验在根内，越界抛 `HttpError(400)`
  - `list(relPath: string): Promise<DirEntry[]>`
  - `read(relPath: string): Promise<{content: string, utf8: boolean}>`
  - `write(relPath: string, content: string): Promise<void>`
  - `mkdir(relPath: string): Promise<void>`
  - `rename(relPath: string, toRel: string): Promise<void>`
  - `del(relPath: string): Promise<void>`
  - `type DirEntry = { name: string; type: 'file'|'dir'; size: number; mtime: number }`

- [ ] **Step 1: 写失败测试**

```ts
// server/files.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStore } from './files.ts';
import { HttpError } from './http-error.ts';

let root: string;
let store: FileStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-test-'));
  store = new FileStore(root);
  await mkdir(path.join(root, 'sub'));
  await writeFile(path.join(root, 'a.txt'), 'hello');
  await writeFile(path.join(root, 'sub', 'b.txt'), 'world');
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('resolve 拒绝目录穿越', () => {
  assert.throws(() => store.resolve('../outside'), (e: HttpError) => e.status === 400);
  assert.throws(() => store.resolve('/etc/passwd'), (e: HttpError) => e.status === 400);
  assert.throws(() => store.resolve('sub/../../x'), (e: HttpError) => e.status === 400);
  assert.equal(store.resolve('a.txt'), path.join(root, 'a.txt'));
});

test('list 返回目录条目', async () => {
  const entries = await store.list('.');
  assert.deepEqual(entries.map(e => e.name).sort(), ['a.txt', 'sub']);
  const file = entries.find(e => e.name === 'a.txt')!;
  assert.equal(file.type, 'file');
  assert.equal(file.size, 5);
});

test('read/write 往返', async () => {
  assert.equal((await store.read('a.txt')).content, 'hello');
  await store.write('sub/b.txt', '你好');
  assert.equal((await store.read('sub/b.txt')).content, '你好');
});

test('read 不存在的文件抛 404', async () => {
  assert.throws(() => store.read('nope.txt'), (e: HttpError) => e.status === 404);
});

test('mkdir/rename/del 生效', async () => {
  await store.mkdir('newdir');
  assert.ok((await readdir(path.join(root, 'newdir'))).length === 0);
  await store.rename('a.txt', 'renamed.txt');
  assert.equal((await store.read('renamed.txt')).content, 'hello');
  await store.del('renamed.txt');
  await assert.rejects(store.read('renamed.txt'));
});

test('rename 目标越界拒绝', async () => {
  assert.throws(() => store.rename('a.txt', '../evil.txt'), (e: HttpError) => e.status === 400);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/files.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 files.ts**

```ts
// server/files.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HttpError } from './http-error.ts';

export type DirEntry = {
  name: string;
  type: 'file' | 'dir';
  size: number;
  mtime: number;
};

export class FileStore {
  constructor(private root: string) {}

  /** 规范化 + 根目录边界校验。越界抛 400。 */
  resolve(relPath: string): string {
    if (typeof relPath !== 'string' || relPath === '') {
      throw new HttpError(400, 'invalid path');
    }
    const abs = path.resolve(this.root, relPath);
    const rootAbs = path.resolve(this.root);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
      throw new HttpError(400, 'path escapes root');
    }
    return abs;
  }

  async list(relPath: string): Promise<DirEntry[]> {
    const dir = this.resolve(relPath);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
    const entries = await Promise.all(
      names.map(async (name) => {
        const st = await fs.stat(path.join(dir, name));
        return {
          name,
          type: st.isDirectory() ? 'dir' : 'file',
          size: st.size,
          mtime: st.mtimeMs,
        };
      }),
    );
    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async read(relPath: string): Promise<{ content: string; utf8: boolean }> {
    const abs = this.resolve(relPath);
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
    const utf8 = !this.hasInvalidUtf8(buf);
    return { content: utf8 ? buf.toString('utf8') : buf.toString('latin1'), utf8 };
  }

  async write(relPath: string, content: string): Promise<void> {
    const abs = this.resolve(relPath);
    try {
      await fs.writeFile(abs, content, 'utf8');
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  async mkdir(relPath: string): Promise<void> {
    const abs = this.resolve(relPath);
    try {
      await fs.mkdir(abs);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  async rename(relPath: string, toRel: string): Promise<void> {
    const from = this.resolve(relPath);
    const to = this.resolve(toRel); // 目标同样过边界校验
    try {
      await fs.rename(from, to);
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  async del(relPath: string): Promise<void> {
    const abs = this.resolve(relPath);
    try {
      await fs.rm(abs, { recursive: true });
    } catch (e: unknown) {
      throw this.mapFsError(e);
    }
  }

  private hasInvalidUtf8(buf: Buffer): boolean {
    // UTF-8 解码出现替换符（U+FFFD）即视为非 UTF-8
    return buf.toString('utf8').includes('�');
  }

  private mapFsError(e: unknown): HttpError {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return new HttpError(404, 'not found');
    if (code === 'EISDIR') return new HttpError(400, 'is a directory');
    if (code === 'EACCES' || code === 'EPERM') return new HttpError(403, 'permission denied');
    if (code === 'EEXIST') return new HttpError(409, 'already exists');
    return new HttpError(500, `filesystem error: ${code ?? 'unknown'}`);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/files.test.ts`
Expected: PASS（7 个测试）

- [ ] **Step 5: 提交**

```bash
git add server/files.ts server/files.test.ts
git commit -m "feat: 文件系统访问层（路径安全 + 目录穿越防护）"
```

---

### Task 3: 写入校验（write-gate.ts）

**Files:**
- Create: `server/write-gate.ts`
- Create: `server/write-gate.test.ts`

**Interfaces:**
- Consumes: `HttpError`（Task 1）
- Produces: `class WriteGate`（供 Task 5、7 使用）：`constructor(allowWrites: boolean)`；`assertWritable(ro?: string): void`

- [ ] **Step 1: 写失败测试**

```ts
// server/write-gate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WriteGate } from './write-gate.ts';
import { HttpError } from './http-error.ts';

test('未开 --rw 时所有写入拒绝（即使 ro=0）', () => {
  const gate = new WriteGate(false);
  assert.throws(() => gate.assertWritable('0'), (e: HttpError) => e.status === 403);
  assert.throws(() => gate.assertWritable(undefined), (e: HttpError) => e.status === 403);
});

test('开 --rw 后 ro=1 或缺失拒绝，ro=0 放行', () => {
  const gate = new WriteGate(true);
  gate.assertWritable('0'); // 不抛
  assert.throws(() => gate.assertWritable('1'), (e: HttpError) => e.status === 403);
  assert.throws(() => gate.assertWritable(undefined), (e: HttpError) => e.status === 403);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/write-gate.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 write-gate.ts**

```ts
// server/write-gate.ts
import { HttpError } from './http-error.ts';

/**
 * 写入权限 = 双条件：启动参数 --rw 是必要前提；请求 ro=0 是充分条件。
 * 前端按钮只改 URL ro 参数，服务端这里才是最终裁决者。
 */
export class WriteGate {
  constructor(private allowWrites: boolean) {}

  assertWritable(ro?: string): void {
    if (!this.allowWrites) {
      throw new HttpError(403, '服务器为只读模式（以 --rw 启动以允许写入）');
    }
    if (ro !== '0') {
      throw new HttpError(403, '当前为只读模式（切换编辑模式后再写入）');
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/write-gate.test.ts`
Expected: PASS（2 个测试）

- [ ] **Step 5: 提交**

```bash
git add server/write-gate.ts server/write-gate.test.ts
git commit -m "feat: 写入校验（--rw 前提 + ro 状态双条件）"
```

---

### Task 4: 内存标签存储（tab-store.ts）

**Files:**
- Create: `server/tab-store.ts`
- Create: `server/tab-store.test.ts`

**Interfaces:**
- Consumes: 无外部依赖（纯 TS）
- Produces: `class TabStore`（供 Task 6、7 使用）：
  - `constructor(heartbeatTimeoutMs = 90_000, now: () => number = Date.now)`
  - `list(): string[]` —— 有序副本
  - `open(userId: string, path: string): void`
  - `close(userId: string, path: string): void`
  - `setFront(userId: string, path: string | null): void`
  - `heartbeat(userId: string): void`
  - `restore(paths: string[]): boolean` —— 服务器列表为空才生效，返回是否成功
  - 任何操作顺带刷新该用户 lastSeen（活跃 = now − lastSeen < timeout）

- [ ] **Step 1: 写失败测试**

```ts
// server/tab-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TabStore } from './tab-store.ts';

// 可控时钟
function makeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test('open 追加标签并记录持有；close 移除前台持有者后标签消失', () => {
  const { now, advance } = makeClock();
  const s = new TabStore(90_000, now);

  s.open('u1', 'a.ts');
  s.open('u1', 'b.ts');
  s.setFront('u1', 'a.ts');
  s.open('u2', 'a.ts');

  assert.deepEqual(s.list(), ['a.ts', 'b.ts']);

  // u2 关闭 a.ts：u1 活跃且前台持有 → 保留
  s.close('u2', 'a.ts');
  assert.deepEqual(s.list(), ['a.ts', 'b.ts']);

  // u1 关闭 a.ts：无活跃前台持有 → 移除
  s.close('u1', 'a.ts');
  assert.deepEqual(s.list(), ['b.ts']);
});

test('不活跃用户的前台持有被忽略', () => {
  const { now, advance } = makeClock();
  const s = new TabStore(90_000, now);

  s.open('u1', 'a.ts');
  s.setFront('u1', 'a.ts');

  advance(95_000); // u1 心跳超时 → 不活跃
  s.open('u2', 'a.ts');
  s.close('u2', 'a.ts'); // 忽略 u1 的前台持有
  assert.deepEqual(s.list(), []); // a.ts 被移除
});

test('心跳刷新活跃度；前台切换为单值', () => {
  const { now, advance } = makeClock();
  const s = new TabStore(90_000, now);

  s.open('u1', 'a.ts');
  s.setFront('u1', 'a.ts');
  advance(89_000);
  s.heartbeat('u1'); // 续命
  advance(5_000);
  s.open('u2', 'a.ts');
  s.close('u2', 'a.ts'); // u1 仍活跃 → 保留
  assert.deepEqual(s.list(), ['a.ts']);

  // 前台切走再关闭 → 无前台持有 → 移除
  s.setFront('u1', 'b.ts');
  s.open('u1', 'b.ts');
  s.close('u1', 'a.ts');
  assert.deepEqual(s.list(), ['b.ts']);
});

test('restore 仅在服务器列表为空时生效', () => {
  const s = new TabStore();
  assert.equal(s.restore(['x.ts', 'y.ts']), true);
  assert.deepEqual(s.list(), ['x.ts', 'y.ts']);
  assert.equal(s.restore(['z.ts']), false); // 已非空 → 拒绝
  assert.deepEqual(s.list(), ['x.ts', 'y.ts']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/tab-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 tab-store.ts**

```ts
// server/tab-store.ts
type UserState = { front: string | null; opened: Set<string>; lastSeen: number };

/**
 * 内存级共享标签存储。存续规则：
 * 标签从列表移除 ⟺ 没有任何活跃用户把 front 指向它。
 * 不活跃（心跳超时）用户的前台持有被忽略，但其 opened 集合保留。
 */
export class TabStore {
  private tabs: string[] = [];
  private users = new Map<string, UserState>();

  constructor(
    private heartbeatTimeoutMs = 90_000,
    private now: () => number = Date.now,
  ) {}

  list(): string[] {
    return [...this.tabs];
  }

  open(userId: string, path: string): void {
    const u = this.user(userId);
    u.opened.add(path);
    if (!this.tabs.includes(path)) this.tabs.push(path);
  }

  close(userId: string, path: string): void {
    const u = this.user(userId);
    u.opened.delete(path);
    if (u.front === path) u.front = null;
    if (this.hasActiveFront(path)) return;
    this.tabs = this.tabs.filter((t) => t !== path);
  }

  setFront(userId: string, path: string | null): void {
    this.user(userId).front = path;
  }

  heartbeat(userId: string): void {
    this.user(userId); // user() 内刷新 lastSeen
  }

  restore(paths: string[]): boolean {
    if (this.tabs.length > 0) return false;
    this.tabs = [...new Set(paths)];
    return true;
  }

  private user(userId: string): UserState {
    let u = this.users.get(userId);
    if (!u) {
      u = { front: null, opened: new Set(), lastSeen: this.now() };
      this.users.set(userId, u);
    }
    u.lastSeen = this.now(); // 任何操作顺带更新心跳
    return u;
  }

  private isActive(u: UserState): boolean {
    return this.now() - u.lastSeen < this.heartbeatTimeoutMs;
  }

  private hasActiveFront(path: string): boolean {
    for (const u of this.users.values()) {
      if (u.front === path && this.isActive(u)) return true;
    }
    return false;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/tab-store.test.ts`
Expected: PASS（4 个测试）

- [ ] **Step 5: 提交**

```bash
git add server/tab-store.ts server/tab-store.test.ts
git commit -m "feat: 内存标签存储（存续规则 + 心跳超时 + restore）"
```

---

### Task 5: HTTP 服务器框架 + 文件路由

**Files:**
- Create: `server/http.ts`
- Create: `server/routes/fs.ts`
- Create: `server/routes/fs.test.ts`（冒烟测试：真实启动服务器 + fetch）

**Interfaces:**
- Consumes: `HttpError`（Task 1）、`FileStore`（Task 2）、`WriteGate`（Task 3）
- Produces:
  - `class HttpServer`（供 Task 6、7 使用）：`constructor({staticDir: string})`；`get/put/post(pattern: string, handler)`；`listen(port, host): Promise<void>`；`close(): Promise<void>`；静态托管 + SPA fallback 内置
  - `type Handler = (req: IncomingMessage, body: unknown, query: URLSearchParams) => Promise<unknown> | unknown` —— handler 返回值自动 JSON 序列化，抛 `HttpError` 自动映射状态码
  - `registerFsRoutes(http: HttpServer, files: FileStore, gate: WriteGate): void`

- [ ] **Step 1: 写失败测试（冒烟）**

```ts
// server/routes/fs.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpServer } from '../http.ts';
import { FileStore } from '../files.ts';
import { WriteGate } from '../write-gate.ts';
import { registerFsRoutes } from './fs.ts';

let root: string;
let server: HttpServer;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-http-'));
  await writeFile(path.join(root, 'a.txt'), 'hello');
  server = new HttpServer({ staticDir: '' });
  registerFsRoutes(server, new FileStore(root), new WriteGate(false)); // 只读
  await server.listen(0, '127.0.0.1');
  const addr = server.address()!;
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

test('list 返回 JSON', async () => {
  const res = await fetch(`${base}/api/list?path=.`);
  assert.equal(res.status, 200);
  const body = await res.json() as { name: string }[];
  assert.ok(body.some((e) => e.name === 'a.txt'));
});

test('read 返回内容', async () => {
  const res = await fetch(`${base}/api/file?path=a.txt`);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { content: string }).content, 'hello');
});

test('只读模式下 write 返回 403', async () => {
  const res = await fetch(`${base}/api/file?path=a.txt&ro=0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'x' }),
  });
  assert.equal(res.status, 403);
});

test('目录穿越返回 400', async () => {
  const res = await fetch(`${base}/api/file?path=..%2F..%2Fetc%2Fpasswd`);
  assert.equal(res.status, 400);
});

test('未知 API 返回 404 JSON', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.ok((await res.json()).error);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/routes/fs.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 http.ts**

```ts
// server/http.ts
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http-error.ts';

export type Handler = (
  req: IncomingMessage,
  body: unknown,
  query: URLSearchParams,
) => Promise<unknown> | unknown;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export class HttpServer {
  private routes = new Map<string, Map<string, Handler>>();
  private server = createServer((req, res) => void this.handle(req, res));
  private staticDir: string;

  constructor(opts: { staticDir: string }) {
    this.staticDir = opts.staticDir;
  }

  get(pattern: string, h: Handler) { this.add('GET', pattern, h); }
  put(pattern: string, h: Handler) { this.add('PUT', pattern, h); }
  post(pattern: string, h: Handler) { this.add('POST', pattern, h); }

  private add(method: string, pattern: string, h: Handler) {
    if (!this.routes.has(method)) this.routes.set(method, new Map());
    this.routes.get(method)!.set(pattern, h);
  }

  async listen(port: number, host: string) {
    return new Promise<void>((resolve) => this.server.listen(port, host, resolve));
  }
  close() {
    return new Promise<void>((resolve, reject) =>
      this.server.close((e) => (e ? reject(e) : resolve())),
    );
  }
  address() { return this.server.address(); }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        await this.serveStatic(url.pathname, res);
        return;
      }
      const handler = this.routes.get(req.method ?? '')?.get(url.pathname);
      if (!handler) throw new HttpError(404, 'not found');
      const body = await readBody(req);
      const result = await handler(req, body, url.searchParams);
      res.json(result ?? { ok: true });
    } catch (e: unknown) {
      if (e instanceof HttpError) {
        res.json({ error: e.message }, e.status);
      } else {
        res.json({ error: 'internal error' }, 500);
      }
    }
  }

  /** 静态资源 + SPA fallback：存在则返回文件，否则返回 index.html */
  private async serveStatic(urlPath: string, res: ServerResponse) {
    const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
    const abs = path.resolve(this.staticDir, rel);
    if (!abs.startsWith(path.resolve(this.staticDir) + path.sep) && rel !== 'index.html') {
      throw new HttpError(400, 'bad path');
    }
    let content: Buffer;
    try {
      content = await readFile(abs);
    } catch {
      // SPA fallback：任意路径都回 index.html
      content = await readFile(path.join(this.staticDir, 'index.html'));
    }
    const ext = path.extname(abs);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': content.length,
    });
    res.end(content);
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}
```

- [ ] **Step 4: 实现 routes/fs.ts**

```ts
// server/routes/fs.ts
import type { HttpServer, Handler } from '../http.ts';
import type { FileStore } from '../files.ts';
import type { WriteGate } from '../write-gate.ts';

export function registerFsRoutes(
  http: HttpServer,
  files: FileStore,
  gate: WriteGate,
): void {
  http.get('/api/list', async (_req, _body, q) => {
    return { entries: await files.list(q.get('path') ?? '.') };
  });

  http.get('/api/file', async (_req, _body, q) => {
    const p = q.get('path');
    if (!p) throw new HttpError(400, 'missing path');
    return await files.read(p);
  });

  http.put('/api/file', async (_req, body, q) => {
    const p = q.get('path');
    if (!p) throw new HttpError(400, 'missing path');
    const { content } = body as { content?: string };
    if (typeof content !== 'string') throw new HttpError(400, 'missing content');
    gate.assertWritable(q.get('ro') ?? undefined);
    await files.write(p, content);
  });

  http.post('/api/mkdir', async (_req, body) => {
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    gate.assertWritable();
    await files.mkdir(p);
  });

  http.post('/api/rename', async (_req, body) => {
    const { path: p, to } = body as { path?: string; to?: string };
    if (!p || !to) throw new HttpError(400, 'missing path/to');
    gate.assertWritable();
    await files.rename(p, to);
  });

  http.post('/api/delete', async (_req, body) => {
    const { path: p } = body as { path?: string };
    if (!p) throw new HttpError(400, 'missing path');
    gate.assertWritable();
    await files.del(p);
  });
}
```

（`HttpError` 需在 fs.ts 中 import：`import { HttpError } from '../http-error.ts';`）

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test server/routes/fs.test.ts`
Expected: PASS（5 个测试）

- [ ] **Step 6: 提交**

```bash
git add server/http.ts server/routes/fs.ts server/routes/fs.test.ts
git commit -m "feat: HTTP 框架（路由/JSON/静态/fallback）+ 文件 API"
```

---

### Task 6: 标签路由 + 服务器冒烟测试

**Files:**
- Create: `server/routes/tabs.ts`
- Create: `server/routes/tabs.test.ts`

**Interfaces:**
- Consumes: `HttpServer`（Task 5）、`TabStore`（Task 4）
- Produces: `registerTabsRoutes(http: HttpServer, tabs: TabStore): void`
  - `GET /api/tabs` → `{tabs: string[]}`
  - `PUT /api/tabs/open` `{path}`；`PUT /api/tabs/close` `{path}`；`PUT /api/tabs/front` `{path}`；`PUT /api/tabs/restore` `{paths}`；`PUT /api/heartbeat`
  - 用户身份：请求头 `x-user-id`（缺失视为匿名单用户 `'anon'`）

- [ ] **Step 1: 写失败测试**

```ts
// server/routes/tabs.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HttpServer } from '../http.ts';
import { TabStore } from '../tab-store.ts';
import { registerTabsRoutes } from './tabs.ts';

let server: HttpServer;
let base: string;

beforeEach(async () => {
  server = new HttpServer({ staticDir: '' });
  registerTabsRoutes(server, new TabStore());
  await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => { await server.close(); });

async function call(method: string, path: string, body?: unknown, userId = 'u1') {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('open/front/list 全流程', async () => {
  await call('PUT', '/api/tabs/open', { path: 'a.ts' }, 'u1');
  await call('PUT', '/api/tabs/front', { path: 'a.ts' }, 'u1');
  const { status, body } = await call('GET', '/api/tabs');
  assert.equal(status, 200);
  assert.deepEqual(body.tabs, ['a.ts']);
});

test('close：他人前台持有则保留', async () => {
  await call('PUT', '/api/tabs/open', { path: 'a.ts' }, 'u1');
  await call('PUT', '/api/tabs/front', { path: 'a.ts' }, 'u1');
  const { status, body } = await call('PUT', '/api/tabs/close', { path: 'a.ts' }, 'u2');
  assert.equal(status, 200);
  const list = await call('GET', '/api/tabs');
  assert.deepEqual(list.body.tabs, ['a.ts']);
});

test('restore 仅空列表时生效', async () => {
  await call('PUT', '/api/tabs/restore', { paths: ['x.ts'] });
  await call('PUT', '/api/tabs/restore', { paths: ['y.ts'] }); // 第二次应被拒
  const { body } = await call('GET', '/api/tabs');
  assert.deepEqual(body.tabs, ['x.ts']);
});

test('heartbeat 保活', async () => {
  await call('PUT', '/api/tabs/open', { path: 'a.ts' }, 'u1');
  await call('PUT', '/api/tabs/front', { path: 'a.ts' }, 'u1');
  await call('PUT', '/api/heartbeat', undefined, 'u1');
  const { body } = await call('GET', '/api/tabs');
  assert.deepEqual(body.tabs, ['a.ts']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/routes/tabs.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 routes/tabs.ts**

```ts
// server/routes/tabs.ts
import type { HttpServer, Handler } from '../http.ts';
import { HttpError } from '../http-error.ts';
import type { TabStore } from '../tab-store.ts';

export function registerTabsRoutes(http: HttpServer, tabs: TabStore): void {
  const userId = (req: import('node:http').IncomingMessage): string =>
    req.headers['x-user-id'] ?? 'anon';

  http.get('/api/tabs', async (req) => ({ tabs: tabs.list(), user: userId(req) }));

  const withPath =
    (fn: (userId: string, path: string) => void): Handler =>
    async (req, body) => {
      const p = (body as { path?: string }).path;
      if (typeof p !== 'string') throw new HttpError(400, 'missing path');
      fn(userId(req), p);
    };

  http.put('/api/tabs/open', withPath((u, p) => tabs.open(u, p)));
  http.put('/api/tabs/close', withPath((u, p) => tabs.close(u, p)));
  http.put('/api/tabs/front', withPath((u, p) => tabs.setFront(u, p)));

  http.put('/api/tabs/restore', async (_req, body) => {
    const paths = (body as { paths?: unknown }).paths;
    if (!Array.isArray(paths)) throw new HttpError(400, 'missing paths');
    return { restored: tabs.restore(paths.filter((x) => typeof x === 'string')) };
  });

  http.put('/api/heartbeat', async (req) => {
    tabs.heartbeat(userId(req));
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/routes/tabs.test.ts`
Expected: PASS（4 个测试）

- [ ] **Step 5: 提交**

```bash
git add server/routes/tabs.ts server/routes/tabs.test.ts
git commit -m "feat: 标签 API（open/close/front/restore/heartbeat）"
```

---

### Task 7: CLI 入口（bin/anther）

**Files:**
- Create: `server/cli.ts`
- Create: `bin/anther.js`

**Interfaces:**
- Consumes: `HttpServer`（Task 5）、`FileStore`（Task 2）、`WriteGate`（Task 3）、`TabStore`（Task 4）、`registerFsRoutes`（Task 5）、`registerTabsRoutes`（Task 6）
- Produces: 可运行命令。用法：`anther [目录] [--port <n>] [--rw]`；目录默认当前目录；端口默认 3000。

- [ ] **Step 1: 写失败测试（参数解析纯函数）**

```ts
// server/cli.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './cli.ts';

test('默认：当前目录、端口 3000、只读', () => {
  const a = parseArgs([]);
  assert.equal(a.port, 3000);
  assert.equal(a.allowWrites, false);
});

test('解析目录、端口、--rw', () => {
  const a = parseArgs(['/tmp/foo', '--port', '8080', '--rw']);
  assert.equal(a.dir, '/tmp/foo');
  assert.equal(a.port, 8080);
  assert.equal(a.allowWrites, true);
});

test('非法端口报错', () => {
  assert.throws(() => parseArgs(['--port', 'abc']));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/cli.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 cli.ts 与 bin/anther.js**

```ts
// server/cli.ts
import path from 'node:path';
import { HttpServer } from './http.ts';
import { FileStore } from './files.ts';
import { WriteGate } from './write-gate.ts';
import { TabStore } from './tab-store.ts';
import { registerFsRoutes } from './routes/fs.ts';
import { registerTabsRoutes } from './routes/tabs.ts';

export type CliArgs = { dir: string; port: number; allowWrites: boolean };

export function parseArgs(argv: string[]): CliArgs {
  let dir = process.cwd();
  let port = 3000;
  let allowWrites = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rw') { allowWrites = true; continue; }
    if (a === '--port') {
      const raw = argv[++i];
      if (!raw || !/^\d+$/.test(raw)) throw new Error('invalid --port');
      port = Number(raw);
      continue;
    }
    if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
    positional.push(a);
  }
  if (positional.length > 1) throw new Error('too many arguments');
  if (positional.length === 1) dir = path.resolve(positional[0]);
  return { dir, port, allowWrites };
}

export async function main(argv: string[]): Promise<void> {
  const { dir, port, allowWrites } = parseArgs(argv);
  const files = new FileStore(dir);
  const gate = new WriteGate(allowWrites);
  const tabs = new TabStore();

  const http = new HttpServer({ staticDir: path.resolve(import.meta.dirname, '../dist/web') });
  registerFsRoutes(http, files, gate);
  registerTabsRoutes(http, tabs);

  await http.listen(port, '0.0.0.0');
  console.log(`anther 已启动：http://localhost:${port}`);
  console.log(`根目录：${dir}`);
  console.log(allowWrites ? '模式：可读写' : '模式：只读（以 --rw 启动以允许写入）');
}
```

```js
#!/usr/bin/env node
// bin/anther.js —— 发布形态入口（构建后指向 dist/server/cli.js）
import { main } from '../dist/server/cli.js';
main(process.argv.slice(2)).catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
```

- [ ] **Step 4: 运行测试 + 手动冒烟**

Run: `node --test server/cli.test.ts`
Expected: PASS（3 个测试）

Run: `node --experimental-transform-types server/cli.ts --port 3100 --rw &` 然后 `curl -s http://localhost:3100/api/list?path=.`
Expected: JSON 数组（当前项目目录列表）

- [ ] **Step 5: 提交**

```bash
git add server/cli.ts server/cli.test.ts bin/anther.js
git commit -m "feat: CLI 入口（目录/端口/--rw）"
```

---

### Task 8: 前端脚手架（Vite + Solid + 布局骨架）

**Files:**
- Create: `web/index.html`
- Create: `web/vite.config.ts`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`（布局断点、工具栏、抽屉骨架、视图注册表挂载）
- Create: `web/src/stores.ts`（信号：currentFile/roMode/tabs）
- Create: `web/src/views/registry.ts`
- Create: `web/src/views/filetree.tsx`（占位视图）
- Create: `web/src/views/tabs.tsx`（占位视图）
- Create: `web/src/styles.css`

**Interfaces:**
- Consumes: 无（纯 UI 骨架）
- Produces:
  - `stores.ts`: `currentFile: Signal<string|null>`、`roMode: Signal<boolean>`、`tabs: Signal<string[]>`（后续 Task 10-14 读写）
  - `views/registry.ts`: `type ViewDef = { id: string; icon: string; title: string; render: () => JSX.Element }`；`export const views: ViewDef[]`（Task 11、12 填入真实实现）
  - `App.tsx` 导出的断点工具 `useIsNarrow(): () => boolean`（matchMedia <600px）

- [ ] **Step 1: 写基础文件**

`web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#111" />
  <title>anther</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

`web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [solid()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/web'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

`web/src/main.tsx`:

```tsx
import { render } from 'solid-js/web';
import { App } from './App.tsx';
import './styles.css';

render(() => <App />, document.getElementById('root')!);
```

`web/src/stores.ts`:

```ts
import { createSignal } from 'solid-js';

export const [currentFile, setCurrentFile] = createSignal<string | null>(null);
export const [roMode, setRoMode] = createSignal(true);
export const [tabs, setTabs] = createSignal<string[]>([]);
```

`web/src/views/registry.ts`:

```tsx
import type { JSX } from 'solid-js';
import { FileTreeView } from './filetree.tsx';
import { TabsView } from './tabs.tsx';

export type ViewDef = { id: string; icon: string; title: string; render: () => JSX.Element };

export const views: ViewDef[] = [
  { id: 'filetree', icon: '🗂', title: '文件', render: () => <FileTreeView /> },
  { id: 'tabs', icon: '📑', title: '标签', render: () => <TabsView /> },
];
```

`web/src/views/filetree.tsx`:

```tsx
export function FileTreeView() {
  return <div class="view-placeholder">文件树（Task 11 实现）</div>;
}
```

`web/src/views/tabs.tsx`:

```tsx
export function TabsView() {
  return <div class="view-placeholder">标签列表（Task 12 实现）</div>;
}
```

`web/src/App.tsx`:

```tsx
import { createSignal, createEffect, For, Show } from 'solid-js';
import { views } from './views/registry.tsx';
import { roMode, setRoMode } from './stores.ts';

const NARROW_QUERY = '(max-width: 599px)';

export function useIsNarrow(): () => boolean {
  const [narrow, setNarrow] = createSignal(
    typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );
  if (typeof window !== 'undefined') {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
  }
  return narrow;
}

export function App() {
  const isNarrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [activeView, setActiveView] = createSignal('filetree');

  return (
    <div class={`app ${isNarrow() ? 'narrow' : 'wide'}`}>
      <header class="toolbar">
        <button class="icon-btn" onClick={() => setDrawerOpen(!drawerOpen())} title="菜单">
          ☰
        </button>
        <span class="toolbar-path">{/* Task 13: 当前文件路径 */}</span>
        <button
          class={`icon-btn ${roMode() ? '' : 'active'}`}
          onClick={() => setRoMode(!roMode())}
          title={roMode() ? '切换为编辑模式' : '切换为只读模式'}
        >
          ✎
        </button>
      </header>

      <main class="editor-area">{/* Task 13: CodeMirror */}</main>

      <Show when={drawerOpen()}>
        <div class="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
        <aside class="drawer">
          <nav class="drawer-views">
            <For each={views}>
              {(v) => (
                <button
                  class={activeView() === v.id ? 'view-tab active' : 'view-tab'}
                  onClick={() => setActiveView(v.id)}
                  title={v.title}
                >
                  {v.icon}
                </button>
              )}
            </For>
          </nav>
          <div class="drawer-content">
            <For each={views}>
              {(v) => (
                <Show when={activeView() === v.id}>{v.render()}</Show>
              )}
            </For>
          </div>
        </aside>
      </Show>
    </div>
  );
}
```

`web/src/styles.css`（骨架，含 dvh 与暗色跟随系统）:

```css
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font-family: system-ui, -apple-system, sans-serif; }

.app { display: flex; flex-direction: column; height: 100dvh; }

.toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.toolbar-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.icon-btn {
  background: none; border: none; font-size: 20px;
  padding: 6px 10px; border-radius: 6px; cursor: pointer;
}
.icon-btn.active { background: var(--accent); color: white; }

.editor-area { flex: 1 1 auto; min-height: 0; overflow: hidden; }

.drawer {
  position: fixed; top: 0; bottom: 0; left: 0; width: min(320px, 85vw);
  background: var(--bg); border-right: 1px solid var(--border);
  display: flex; z-index: 10;
  animation: slide-in 0.18s ease;
}
@keyframes slide-in { from { transform: translateX(-100%); } }
.drawer-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 9;
}
.drawer-views { display: flex; flex-direction: column; gap: 4px; padding: 8px 4px; border-right: 1px solid var(--border); }
.drawer-views .view-tab { background: none; border: none; font-size: 18px; padding: 8px; border-radius: 6px; }
.drawer-views .view-tab.active { background: var(--accent); }
.drawer-content { flex: 1; overflow-y: auto; padding: 8px; }

.view-placeholder { color: var(--muted); padding: 12px; font-size: 13px; }

:root {
  --bg: #ffffff; --border: #e0e0e0; --muted: #888; --accent: #3b82f6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --border: #2a2a30; --muted: #8a8a93; --accent: #60a5fa;
  }
  body { background: var(--bg); color: #e8e8ea; }
}
@media (min-width: 600px) { /* 横屏/桌面：抽屉常驻 */
  .drawer { position: static; width: 260px; animation: none; }
  .drawer-backdrop { display: none; }
}
```

- [ ] **Step 2: 安装依赖并启动验证**

Run: `npm install && npm run build`
Expected: 构建成功，`dist/web/index.html` 存在

Run: `npm run dev`
Expected: 浏览器打开 http://localhost:5173 可见工具栏 + ☰ 可打开抽屉（两个占位视图）

- [ ] **Step 3: 提交**

```bash
git add web/ package.json package-lock.json
git commit -m "feat: 前端脚手架（Solid + Vite + 布局骨架 + 视图注册表）"
```

---

### Task 9: URL 状态协议（url-state.ts，纯函数）

**Files:**
- Create: `web/src/url-state.ts`
- Create: `web/src/url-state.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `parseUrl(href: string): UrlState`、`serializeUrl(state: UrlState): string`（供 Task 10、13 使用）
  - `type UrlState = { path: string | null; ro: boolean; theme: 'auto'|'light'|'dark'; fs: number }`
  - 路径保留 `/`（只编码特殊字符）；默认值不序列化（ro=true/theme='auto'/fs=100 省略）；`fs` 钳制 85–130

- [ ] **Step 1: 写失败测试**

```ts
// web/src/url-state.test.ts
import { describe, expect, test } from 'vitest';
import { parseUrl, serializeUrl } from './url-state.ts';

describe('parseUrl', () => {
  test('根路径：无文件，默认值', () => {
    const s = parseUrl('http://host/');
    expect(s).toEqual({ path: null, ro: true, theme: 'auto', fs: 100 });
  });

  test('文件路径 + 全参数', () => {
    const s = parseUrl('http://host/src/index.ts?ro=0&theme=dark&fs=110');
    expect(s).toEqual({ path: 'src/index.ts', ro: false, theme: 'dark', fs: 110 });
  });

  test('路径特殊字符解码（%20 空格，/ 保留）', () => {
    const s = parseUrl('http://host/my%20dir/a.ts');
    expect(s.path).toBe('my dir/a.ts');
  });

  test('未知参数忽略、非法 fs 钳制', () => {
    const s = parseUrl('http://host/a.ts?ro=1&fs=999&view=git&theme=x');
    expect(s).toEqual({ path: 'a.ts', ro: true, theme: 'auto', fs: 130 });
  });
});

describe('serializeUrl', () => {
  test('最简形态：默认值全部省略', () => {
    expect(serializeUrl({ path: 'a.ts', ro: true, theme: 'auto', fs: 100 })).toBe('/a.ts');
  });

  test('非默认值写入参数', () => {
    expect(serializeUrl({ path: 'a.ts', ro: false, theme: 'dark', fs: 110 })).toBe(
      '/a.ts?ro=0&theme=dark&fs=110',
    );
  });

  test('无文件 + 非默认参数', () => {
    expect(serializeUrl({ path: null, ro: false, theme: 'light', fs: 100 })).toBe('/?ro=0&theme=light');
  });

  test('空格等特殊字符编码，斜杠保留', () => {
    expect(serializeUrl({ path: 'my dir/a.ts', ro: true, theme: 'auto', fs: 100 })).toBe(
      '/my%20dir/a.ts',
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --config web/vite.config.ts web/src/url-state.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 url-state.ts**

```ts
// web/src/url-state.ts
export type UrlState = {
  path: string | null;
  ro: boolean;
  theme: 'auto' | 'light' | 'dark';
  fs: number;
};

const DEFAULTS: UrlState = { path: null, ro: true, theme: 'auto', fs: 100 };

/** 路径编码：只编码特殊字符，保留 / 可读 */
function encodePath(p: string): string {
  return p.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}
function decodePath(s: string): string {
  return s.split('/').map((seg) => decodeURIComponent(seg)).join('/');
}

export function parseUrl(href: string): UrlState {
  const url = new URL(href);
  const rawPath = decodeURIComponent(url.pathname);
  const path = rawPath === '/' || rawPath === '' ? null : rawPath.slice(1);

  const ro = url.searchParams.get('ro') !== '0'; // 默认只读

  const themeParam = url.searchParams.get('theme');
  const theme: UrlState['theme'] =
    themeParam === 'light' || themeParam === 'dark' ? themeParam : 'auto';

  const fsRaw = Number(url.searchParams.get('fs'));
  const fs = Number.isFinite(fsRaw) ? Math.min(130, Math.max(85, fsRaw)) : 100;

  return { path, ro, theme, fs };
}

export function serializeUrl(state: UrlState): string {
  const params = new URLSearchParams();
  if (!state.ro) params.set('ro', '0');
  if (state.theme !== 'auto') params.set('theme', state.theme);
  if (state.fs !== 100) params.set('fs', String(state.fs));
  const qs = params.toString();
  const p = state.path === null ? '' : encodePath(state.path);
  return `/${p}${qs ? `?${qs}` : ''}`;
}

export const DEFAULT_STATE: UrlState = { ...DEFAULTS };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --config web/vite.config.ts web/src/url-state.test.ts`
Expected: PASS（7 个测试）

- [ ] **Step 5: 提交**

```bash
git add web/src/url-state.ts web/src/url-state.test.ts
git commit -m "feat: URL 状态协议（parse/serialize 纯函数）"
```

---

### Task 10: API 客户端 + 状态同步（api.ts、stores 扩展）

**Files:**
- Create: `web/src/api.ts`
- Create: `web/src/api.test.ts`（模拟 fetch，纯逻辑测试）
- Modify: `web/src/stores.ts`（增加 sync 函数：initFromUrl、applyPopstate、心跳循环、restore）

**Interfaces:**
- Consumes: `UrlState`（Task 9）
- Produces:
  - `getUserId(): string`（localStorage `anther:userId`，首次生成 UUID）
  - `api.list(path)` / `api.readFile(path)` / `api.writeFile(path, content, ro)` / `api.mkDir` / `api.rename` / `api.del`
  - `api.tabs.list()` / `.open(path)` / `.close(path)` / `.front(path)` / `.restore(paths)` / `.heartbeat()`（全部带 `x-user-id` 头）
  - `ApiError extends Error {status: number}`（非 2xx 时抛）
  - `stores.ts` 新增：`startSync(): void`（加载时调：parse URL → 设 currentFile/roMode → 拉 tabs → restore 快照 → 心跳定时器）

- [ ] **Step 1: 写失败测试**

```ts
// web/src/api.test.ts
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { ApiError, api, getUserId } from './api.ts';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}
beforeEach(() => vi.unstubAllGlobals());

describe('api', () => {
  test('readFile 返回内容', async () => {
    mockFetch(200, { content: 'hi' });
    const r = await api.readFile('a.ts');
    expect(r.content).toBe('hi');
  });

  test('非 2xx 抛 ApiError 携带状态码', async () => {
    mockFetch(403, { error: 'read-only' });
    await expect(api.writeFile('a.ts', 'x', true)).rejects.toMatchObject({ status: 403 });
  });

  test('writeFile 带 ro 参数与 x-user-id 头', async () => {
    const fn = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fn);
    await api.writeFile('a.ts', 'x', false);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('ro=0');
    expect((init.headers as Record<string, string>)['x-user-id']).toBeTruthy();
  });

  test('getUserId 生成并持久化', () => {
    localStorage.clear();
    const id1 = getUserId();
    const id2 = getUserId();
    expect(id1).toBe(id2); // 二次读取同一值
    expect(id1.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --config web/vite.config.ts web/src/api.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 api.ts**

```ts
// web/src/api.ts
const USER_KEY = 'anther:userId';
const TABS_KEY = 'anther:tabsSnapshot';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getUserId(): string {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_KEY, id);
  }
  return id;
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
  mkDir: (path: string) => request('POST', '/api/mkdir', { path }),
  rename: (path: string, to: string) => request('POST', '/api/rename', { path, to }),
  del: (path: string) => request('POST', '/api/delete', { path }),
  tabs: {
    list: () => request<{ tabs: string[] }>('GET', '/api/tabs'),
    open: (path: string) => request('PUT', '/api/tabs/open', { path }),
    close: (path: string) => request('PUT', '/api/tabs/close', { path }),
    front: (path: string) => request('PUT', '/api/tabs/front', { path }),
    restore: (paths: string[]) => request<{ restored: boolean }>('PUT', '/api/tabs/restore', { paths }),
    heartbeat: () => request('PUT', '/api/heartbeat'),
  },
};

export type DirEntry = { name: string; type: 'file' | 'dir'; size: number; mtime: number };
```

- [ ] **Step 4: 扩展 stores.ts（同步逻辑）**

```ts
// web/src/stores.ts
import { createSignal } from 'solid-js';
import { parseUrl, serializeUrl, DEFAULT_STATE, type UrlState } from './url-state.ts';
import { api, loadTabsSnapshot, saveTabsSnapshot } from './api.ts';

export const [currentFile, setCurrentFile] = createSignal<string | null>(null);
export const [roMode, setRoMode] = createSignal(true);
export const [tabs, setTabs] = createSignal<string[]>([]);
export const [theme, setTheme] = createSignal<'auto' | 'light' | 'dark'>('auto');
export const [fontScale, setFontScale] = createSignal(100);

let started = false;

/** 将当前状态写入 URL（replaceState，不污染历史） */
export function pushState(): void {
  const state: UrlState = {
    path: currentFile(),
    ro: roMode(),
    theme: theme(),
    fs: fontScale(),
  };
  const url = serializeUrl(state);
  if (window.location.pathname + window.location.search !== url) {
    window.history.replaceState(null, '', url);
  }
}

/** 页面加载时调用一次：URL → 状态；拉取标签；恢复快照；启动心跳 */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;

  const s = parseUrl(window.location.href);
  setCurrentFile(s.path);
  setRoMode(s.ro);
  setTheme(s.theme);
  setFontScale(s.fs);
  applyTheme(s.theme);

  // 标签：拉取服务器列表；服务器为空（重启过）→ 用本地快照 restore
  try {
    const { tabs: serverTabs } = await api.tabs.list();
    if (serverTabs.length === 0) {
      const snapshot = loadTabsSnapshot();
      if (snapshot && snapshot.length > 0) {
        const { restored } = await api.tabs.restore(snapshot);
        if (restored) setTabs(snapshot);
      }
    } else {
      setTabs(serverTabs);
    }
  } catch { /* 服务器不可达：静默，心跳循环会重试 */ }

  // 心跳：每 30s 上报（保活 + 服务器重启后重连）
  setInterval(() => {
    void api.tabs.heartbeat().catch(() => { /* 静默 */ });
  }, 30_000);

  // 标签变化时更新本地快照（供重启恢复）
  // （在 open/close/front 操作处调用 saveTabsSnapshot）
}

export function applyTheme(t: 'auto' | 'light' | 'dark'): void {
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

// 供 Task 12 使用：打开/关闭/前台操作的统一入口
export async function openTab(path: string): Promise<void> {
  await api.tabs.open(path);
  setCurrentFile(path);
  setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
  await api.tabs.front(path);
  saveTabsSnapshot(tabs());
  pushState();
}

export async function closeTab(path: string): Promise<void> {
  await api.tabs.close(path);
  setTabs((prev) => prev.filter((t) => t !== path));
  if (currentFile() === path) setCurrentFile(null);
  saveTabsSnapshot(tabs());
  pushState();
}
```

（`DirEntry` 类型、`DEFAULT_STATE` 未使用的 import 可删；`serializeUrl` 断言可保留。`roMode` 变化后需调 `pushState()`——Task 13 在切换按钮处处理。）

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --config web/vite.config.ts web/src/api.test.ts`
Expected: PASS（4 个测试）

- [ ] **Step 6: 提交**

```bash
git add web/src/api.ts web/src/api.test.ts web/src/stores.ts
git commit -m "feat: API 客户端 + 状态同步（心跳/恢复/快照）"
```

---

### Task 11: 文件树视图

**Files:**
- Modify: `web/src/views/filetree.tsx`（替换占位）

**Interfaces:**
- Consumes: `api.list`（Task 10）、`openTab`/`setCurrentFile`/`pushState`（Task 10）、`currentFile`（Task 8）
- Produces: 可浏览文件树：懒加载目录（点击展开/收起）、文件点击 → `openTab(path)`、当前文件高亮

- [ ] **Step 1: 实现文件树**

```tsx
// web/src/views/filetree.tsx
import { createSignal, For, Show } from 'solid-js';
import { api, type DirEntry } from '../api.ts';
import { currentFile, openTab } from '../stores.ts';

type Node = { path: string; entry: DirEntry; expanded: boolean; loaded?: DirEntry[]; loading?: boolean };

function TreeNode(props: { node: Node; onToggle: (n: Node) => void }) {
  const n = () => props.node;
  const isCurrent = () => currentFile() === n().path;

  return (
    <div class="tree-node">
      <div
        class={`tree-row ${isCurrent() ? 'active' : ''}`}
        onClick={() => {
          if (n().entry.type === 'dir') props.onToggle(n());
          else void openTab(n().path);
        }}
      >
        <span class="tree-arrow">
          {n().entry.type === 'dir' ? (n().expanded ? '▾' : '▸') : ''}
        </span>
        <span class="tree-name">{n().entry.name}</span>
      </div>
      <Show when={n().expanded && n().loaded}>
        <div class="tree-children">
          <For each={n().loaded}>
            {(child) => (
              <TreeNode
                node={{ path: `${n().path}/${child.name}`, entry: child, expanded: false }}
                onToggle={props.onToggle}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function FileTreeView() {
  const [root, setRoot] = createSignal<Node | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const ensureRoot = async () => {
    if (root()) return;
    try {
      const { entries } = await api.list('.');
      setRoot({
        path: '.',
        entry: { name: '/', type: 'dir', size: 0, mtime: 0 },
        expanded: true,
        loaded: entries,
      });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  void ensureRoot();

  const toggle = async (n: Node) => {
    if (!n.expanded) {
      try {
        const { entries } = await api.list(n.path);
        n.loaded = entries;
        n.expanded = true;
        n.loading = false;
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      n.expanded = false;
    }
    setRoot({ ...root()! });
  };

  return (
    <div class="filetree">
      <Show when={error()}><div class="error-banner">{error()}</div></Show>
      <Show when={root()} fallback={<div class="view-placeholder">加载中…</div>}>
        <For each={root()!.loaded}>
          {(child) => (
            <TreeNode
              node={{ path: child.name, entry: child, expanded: false }}
              onToggle={toggle}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
```

（可变 Node 状态 + 顶层 `setRoot({...root()!})` 强制重渲染——Solid 响应式下此法可行但粗糙；若实现时发现不刷新，可将 `expanded/loaded` 提升为 `createStore`。该视图为 MVP 够用，渲染正确性由下述手动验证保证。）

- [ ] **Step 2: 手动验证（dev 环境）**

Run: `npm run dev`（后端 `node --experimental-transform-types server/cli.ts --rw` 需并行）
Expected: 抽屉 → 文件视图 → 显示项目文件树；点击目录展开；点击文件 → URL 变为 `/文件名`、工具栏显示路径

- [ ] **Step 3: 提交**

```bash
git add web/src/views/filetree.tsx
git commit -m "feat: 文件树视图（懒加载 + 打开文件）"
```

---

### Task 12: 标签列表视图

**Files:**
- Modify: `web/src/views/tabs.tsx`（替换占位）

**Interfaces:**
- Consumes: `tabs`/`currentFile`（Task 8）、`openTab`/`closeTab`（Task 10）
- Produces: 标签纵向列表：当前高亮、点击切换（`openTab`）、行尾 `×` 关闭（`closeTab`）

- [ ] **Step 1: 实现标签视图**

```tsx
// web/src/views/tabs.tsx
import { For, Show } from 'solid-js';
import { currentFile, openTab, closeTab } from '../stores.ts';
import { tabs } from '../stores.ts';

export function TabsView() {
  return (
    <div class="tabs-view">
      <Show when={tabs().length === 0} fallback={
        <ul class="tab-list">
          <For each={tabs()}>
            {(t) => (
              <li class={`tab-row ${currentFile() === t ? 'active' : ''}`}>
                <span
                  class="tab-name"
                  onClick={() => void openTab(t)}
                  title={t}
                >
                  {t.split('/').pop()}
                </span>
                <button class="tab-close" onClick={() => void closeTab(t)} title="关闭">
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      }>
        <div class="view-placeholder">暂无标签，从文件树打开文件</div>
      </Show>
    </div>
  );
}
```

（`styles.css` 追加 `.tab-list/.tab-row/.tab-name/.tab-close/.tree-node/.tree-row/.error-banner` 基础样式——列表行、悬停高亮、活动态强调色，与现有 CSS 变量一致。）

- [ ] **Step 2: 手动验证（dev 环境）**

Expected: 打开多个文件 → 标签视图列出全部；点击切换（URL 同步）；`×` 关闭；关闭当前文件后工具栏路径清空

- [ ] **Step 3: 提交**

```bash
git add web/src/views/tabs.tsx web/src/styles.css
git commit -m "feat: 标签列表视图（切换/关闭）"
```

---

### Task 13: 编辑器封装 + 自动保存 + 只读切换

**Files:**
- Create: `web/src/editor/index.ts`
- Modify: `web/src/App.tsx`（编辑器挂载、加载文件、ro 按钮联动、popstate）
- Modify: `web/src/stores.ts`（只读切换 pushState；当前文件变更时加载文档）

**Interfaces:**
- Consumes: `api.readFile`/`api.writeFile`（Task 10）、`currentFile`/`roMode`/`pushState`（Task 10）、`parseUrl`（Task 9）
- Produces:
  - `createEditor(container: HTMLElement, opts): EditorHandle`（适配层）：
    - `type EditorHandle = { setReadOnly(r: boolean): void; setDoc(doc: string): void; destroy(): void }`
    - `opts: { initialDoc: string; readOnly: boolean; onChange: (doc: string) => void }`
  - 自动保存：编辑变化 → 防抖 1s → `api.writeFile(path, doc, roMode())`；失败重试 3 次（间隔 1s）后 Toast

- [ ] **Step 1: 写失败测试（适配层行为）**

```ts
// web/src/editor/index.test.ts
import { describe, expect, test } from 'vitest';
import { createEditor } from './index.ts';

describe('createEditor', () => {
  test('创建与销毁不抛错', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host, { initialDoc: 'hello', readOnly: true, onChange: () => {} });
    expect(host.textContent).toContain('hello');
    editor.destroy();
    host.remove();
  });

  test('setReadOnly 切换可编辑态', () => {
    const host = document.createElement('div');
    const editor = createEditor(host, { initialDoc: '', readOnly: true, onChange: () => {} });
    expect(() => editor.setReadOnly(false)).not.toThrow();
    editor.destroy();
    host.remove();
  });

  test('setDoc 替换内容', () => {
    const host = document.createElement('div');
    const editor = createEditor(host, { initialDoc: '', readOnly: true, onChange: () => {} });
    editor.setDoc('新内容');
    expect(host.textContent).toContain('新内容');
    editor.destroy();
    host.remove();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --config web/vite.config.ts web/src/editor/index.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现编辑器适配层**

```ts
// web/src/editor/index.ts
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';

export type EditorHandle = {
  setReadOnly(r: boolean): void;
  setDoc(doc: string): void;
  destroy(): void;
};

export type EditorOptions = {
  initialDoc: string;
  readOnly: boolean;
  onChange: (doc: string) => void;
};

const editableCompartment = new Compartment();

export function createEditor(container: HTMLElement, opts: EditorOptions): EditorHandle {
  const view = new EditorView({
    state: EditorState.create({
      doc: opts.initialDoc,
      extensions: [
        basicSetup,
        editableCompartment.of(EditorView.editable.of(!opts.readOnly)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
    parent: container,
  });

  return {
    setReadOnly(r: boolean) {
      view.dispatch({
        effects: editableCompartment.reconfigure(EditorView.editable.of(!r)),
      });
    },
    setDoc(doc: string) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
      });
    },
    destroy() {
      view.destroy();
    },
  };
}
```

- [ ] **Step 4: 接线（App.tsx + stores.ts）**

`web/src/App.tsx` 中编辑器区域改为：

```tsx
// 在 App() 顶部：
import { createEditor, type EditorHandle } from './editor/index.ts';
import { api } from './api.ts';
import { currentFile, roMode, setRoMode, pushState, openTab } from './stores.ts';
import { parseUrl } from './url-state.ts';

let editorEl: HTMLDivElement | undefined;
let editor: EditorHandle | undefined;
let doc = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveAttempts = 0;

// 自动保存：防抖 1s，失败重试 3 次
function scheduleSave(path: string, text: string) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void (async () => {
      try {
        await api.writeFile(path, text, roMode());
        saveAttempts = 0;
      } catch {
        if (saveAttempts < 3) {
          saveAttempts++;
          setTimeout(() => scheduleSave(path, text), 1000);
        } else {
          alert('保存失败，请重试');
          saveAttempts = 0;
        }
      }
    })();
  }, 1000);
}

// 当前文件变化 → 加载文档到编辑器
createEffect(() => {
  const path = currentFile();
  if (!path || !editorEl) return;
  void (async () => {
    const { content } = await api.readFile(path);
    doc = content;
    if (!editor) {
      editor = createEditor(editorEl!, {
        initialDoc: content,
        readOnly: roMode(),
        onChange: (d) => {
          doc = d;
          if (currentFile()) scheduleSave(currentFile()!, d);
        },
      });
    } else {
      editor.setDoc(content);
    }
    editor.setReadOnly(roMode());
  })();
});
```

（编辑器容器元素：`<div ref={editorEl} class="editor-container" />`；`createEffect` 需 import 自 solid-js。**加载文档与自动保存的细节**：`createEffect` 在 currentFile 变化时重跑；`editorEl` 需在首次渲染后存在——用 `ref` 赋值时机保证（Solid 的 ref 回调在 mount 时触发，此时 currentFile 已有值，effect 重跑即可）。若首帧竞态，在 `onMount` 里兜底触发一次同步。该接线在 dev 环境手动验证。）

`App.tsx` 的 ro 按钮改为：

```tsx
onClick={() => {
  const next = !roMode();
  setRoMode(next);
  pushState();
}}
```

`stores.ts` 追加浏览器前进/后退同步（`startSync` 内）：

```ts
window.addEventListener('popstate', () => {
  const s = parseUrl(window.location.href);
  setCurrentFile(s.path);
  setRoMode(s.ro);
  applyTheme(s.theme);
});
```

- [ ] **Step 5: 运行测试 + 手动验证**

Run: `npx vitest run --config web/vite.config.ts web/src/editor/index.test.ts`
Expected: PASS（3 个测试）

手动（dev）：打开文件 → 编辑 → 1s 后磁盘文件已更新；✎ 切换只读 → 编辑被禁（CodeMirror 只读）且 URL `ro` 变化；保存时切只读 → 下次编辑触发 403 Toast（alert 兜底）→ 提示切换模式

- [ ] **Step 6: 提交**

```bash
git add web/src/editor/index.ts web/src/editor/index.test.ts web/src/App.tsx web/src/stores.ts
git commit -m "feat: CodeMirror 适配层 + 自动保存 + 只读切换"
```

---

### Task 14: 集成收尾（前端全链路验证 + 样式打磨）

**Files:**
- Modify: `web/src/App.tsx`、`web/src/stores.ts`、`web/src/styles.css`（按需修正）

**Interfaces:**
- Consumes: 全部已建模块
- Produces: 可运行的完整应用（`npm run build` → `npm start` 一键起服务）

- [ ] **Step 1: 全链路手动验证清单（dev 环境，后端 --rw）**

1. `npm run dev`（或 `npm run build && npm start -- --rw`）
2. 打开 `/` → 文件树；打开 `a.ts` → URL 变 `/a.ts`，编辑器显示内容
3. 编辑 → 等 1s → 磁盘文件更新（`cat` 验证）
4. ✎ 切编辑 → 可写；再切只读 → 编辑器只读
5. 开多个文件 → 标签视图全列出；`×` 关闭；刷新页面 → 服务器列表还在（其他标签保留），URL 文件恢复
6. 浏览器后退/前进 → 当前文件跟随 URL 变化
7. 手机模拟（DevTools 竖屏 390px）→ 抽屉滑出/收起、工具栏完整、布局不溢出
8. 暗色跟随系统（DevTools 模拟 dark scheme）
9. 服务器重启（Ctrl-C 后重启）→ 刷新页面 → 标签从快照恢复

- [ ] **Step 2: 修复清单暴露的问题**（样式/竞态/边界，逐个修复并回归上面清单）

- [ ] **Step 3: 编写 README.md**

```markdown
# anther

移动优先的浏览器代码查看/编辑工具。在浏览器中查看和编辑服务器上的代码，移动端体验优先（区别于 code-server 的桌面 UI 缩放）。

## 使用

```bash
npx anther [目录] [--port <端口>] [--rw]
```

- 默认只读（浏览模式）；`--rw` 允许写入
- 默认端口 3000，目录默认当前目录
- 无数据库、无配置文件；标签列表存服务器内存，重启后由首个访问者的浏览器快照恢复

## 开发

```bash
npm install
npm run dev      # 前端 :5173（代理 /api → :3000），需另起后端：
npm run dev:server -- --rw
npm test         # 后端 node:test
npx vitest run   # 前端测试
npm run build    # 编译后端 + 构建前端
```

## 真机测试清单

见 `docs/superpowers/specs/2026-08-08-anther-design.md` 附录 A。
```

- [ ] **Step 4: 提交**

```bash
git add web/ README.md
git commit -m "feat: 集成收尾 + README"
```

---

### Task 15: 移动端打磨（dvh / 键盘 / 手势细节）

**Files:**
- Modify: `web/src/styles.css`、`web/src/App.tsx`

**Interfaces:**
- Consumes: 全部已建模块
- Produces: 符合 spec §7.4-7.5 的移动端体验

- [ ] **Step 1: 虚拟键盘适配验证与修复**

- 布局高度已是 `100dvh`（Task 8）；验证：DevTools 移动模拟中聚焦编辑器 → 视口压缩时工具栏可见
- 若发现遮挡：编辑器容器改为 `height: 100%; min-height: 0` 配合 flex 弹性压缩（当前 `.editor-area` 已是 `flex: 1 1 auto; min-height: 0`，一般无需改）

- [ ] **Step 2: 光标跟随**

CodeMirror 6 默认在聚焦时滚动光标入视口。验证：竖屏下点按编辑器底部 → 光标可见。

- [ ] **Step 3: 抽屉/标签可触达性检查**

- 抽屉宽度 `min(320px, 85vw)` ✓；关闭按钮 `×` 点击区 ≥ 40px（`padding` 调整）
- 工具栏按钮触控区 ≥ 40px
- 系统返回/边缘手势不拦截（未自定义手势）✓

- [ ] **Step 4: 真机（或 DevTools 触控模拟）回归 spec 附录 A 清单**

逐项过：键盘遮挡、IME 中文输入、抽屉手势、旋转切换、暗色跟随、只读防误触、心跳断线行为（关闭页面等 2 分钟 → 另一用户可关其前台标签）、重启恢复、`fs` 参数生效（`/a.ts?fs=120`）

- [ ] **Step 5: 修复发现的问题并提交**

```bash
git add web/
git commit -m "feat: 移动端体验打磨"
```

---

## 自审记录

- **Spec 覆盖**：§5.1 API 表 → Task 5/6 ✓；§5.3 路径安全 → Task 2 ✓；§5.4 写入双条件 → Task 3/5 ✓；§5.5 标签/心跳/恢复 → Task 4/6/10 ✓；§6 URL 协议 → Task 9/13 ✓；§7.1-7.3 布局/视图注册表 → Task 8/11/12 ✓；§7.5 键盘 → Task 8（dvh）+ Task 15 ✓；§7.6 编辑器/自动保存 → Task 13 ✓；§8 错误处理 → Task 2（错误映射）+ Task 10（ApiError）+ Task 13（重试）✓；§9 测试 → 各任务 TDD ✓；§10 扩展位 → 视图注册表（Task 8）✓
- **已知偏差**：`api.mkDir/rename/del` 与 `/api/state` 路由无前端 UI（MVP 文件管理仅浏览+编辑，写 API 由编辑器自动保存使用）；`/api/state` 暂无消费方——保留 API 不实现 UI。非 UTF-8 提示（spec §5.3）在 read 返回 `utf8` 标记，前端 Toast 提示可在 Task 14 手动验证时补一行（`if (!utf8) alert('非 UTF-8 文件，仅支持 UTF-8 保存')`）。
