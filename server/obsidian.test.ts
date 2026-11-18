import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStore } from './files.ts';
import { ObsidianIndex } from './obsidian.ts';
import { HttpServer } from './http.ts';
import { registerFsRoutes } from './routes/fs.ts';

let root: string;
let files: FileStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-obsidian-'));
  files = new FileStore(root);
  await mkdir(path.join(root, '.obsidian'));
  await mkdir(path.join(root, 'folder'));
  await writeFile(path.join(root, 'Note.md'), '# Root\n');
  await writeFile(path.join(root, 'folder', 'Note.md'), '# Folder\n');
  await writeFile(path.join(root, 'folder', 'A.md'), '# A\n');
  await writeFile(path.join(root, 'folder', 'Only.md'), '# Only\n');
  await writeFile(path.join(root, 'image.png'), 'png');
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('ObsidianIndex：相对当前文件优先，其次根目录，最后按最短路径匹配 basename', async () => {
  const index = new ObsidianIndex(files);
  assert.deepEqual(await index.resolve('Note', 'folder/A.md'), { path: 'folder/Note.md' });
  assert.deepEqual(await index.resolve('Note', 'A.md'), { path: 'Note.md' });
  assert.deepEqual(await index.resolve('Only', 'folder/A.md'), { path: 'folder/Only.md' });
  assert.deepEqual(await index.resolve('folder/Only', ''), { path: 'folder/Only.md' });
  assert.deepEqual(await index.resolve('image.png', ''), { path: 'image.png' });
});

test('ObsidianIndex：支持 heading / block 后缀和同文档 heading', async () => {
  const index = new ObsidianIndex(files);
  assert.deepEqual(await index.resolve('Note#Heading', 'folder/A.md'), { path: 'folder/Note.md', heading: 'Heading' });
  assert.deepEqual(await index.resolve('Note#^block-id', ''), { path: 'Note.md', block: 'block-id' });
  assert.deepEqual(await index.resolve('#Heading#Sub', 'Note.md'), { path: 'Note.md', heading: 'Heading#Sub' });
});

test('ObsidianIndex：缓存未命中时重建索引以发现新笔记', async () => {
  const index = new ObsidianIndex(files);
  assert.deepEqual(await index.resolve('Only', 'folder/A.md'), { path: 'folder/Only.md' });
  await writeFile(path.join(root, 'folder', 'New.md'), '# New\n');
  assert.deepEqual(await index.resolve('New', 'folder/A.md'), { path: 'folder/New.md' });
});

test('ObsidianIndex：解析 frontmatter aliases（列表、内联列表和 deprecated alias）', async () => {
  await writeFile(path.join(root, 'Alias.md'), [
    '---',
    'aliases:',
    '  - Alias One',
    '  - "Alias Two"',
    'alias: Old Name',
    '---',
    '# Alias',
  ].join('\n'));
  await writeFile(path.join(root, 'Inline.md'), '---\naliases: [Inline One, "Inline Two"]\n---\n# Inline\n');
  const index = new ObsidianIndex(files);
  assert.deepEqual(await index.resolve('Alias One', ''), { path: 'Alias.md' });
  assert.deepEqual(await index.resolve('alias two', 'folder/A.md'), { path: 'Alias.md' });
  assert.deepEqual(await index.resolve('Old Name', ''), { path: 'Alias.md' });
  assert.deepEqual(await index.resolve('Inline One', ''), { path: 'Inline.md' });
  assert.deepEqual(await index.resolve('Inline Two', ''), { path: 'Inline.md' });
  assert.deepEqual(await index.resolve('Alias.md', ''), { path: 'Alias.md' });
});

test('ObsidianIndex：未找到和越界目标返回 null', async () => {
  const index = new ObsidianIndex(files);
  assert.equal(await index.resolve('Missing', ''), null);
  assert.equal(await index.resolve('../Note', 'folder/A.md'), null);
  assert.equal(await index.resolve('/etc/passwd', ''), null);
  assert.equal(await index.resolve('#Heading', ''), null);
});

test('GET /api/obsidian/resolve：返回解析结果，未找到为 empty path，缺 target 为 400', async () => {
  const server = new HttpServer({ staticDir: '' });
  registerFsRoutes(server, files);
  await server.listen(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const resolve = async (target: string, from = '') =>
      (await (await fetch(`${base}/api/obsidian/resolve?target=${encodeURIComponent(target)}&from=${encodeURIComponent(from)}`)).json());
    assert.deepEqual(await resolve('Only', 'folder/A.md'), { path: 'folder/Only.md' });
    assert.deepEqual(await resolve('Note#Heading', ''), { path: 'Note.md', heading: 'Heading' });
    assert.deepEqual(await resolve('Missing'), { path: null });
    assert.equal((await fetch(`${base}/api/obsidian/resolve`)).status, 400);
  } finally {
    await server.close();
  }
});
