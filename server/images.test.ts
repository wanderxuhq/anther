import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileStore } from './files.ts';
import { HttpServer } from './http.ts';
import { registerFsRoutes } from './routes/fs.ts';

let root: string, base: string, http: HttpServer;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=', 'base64');
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'anther-images-'));
  await fs.mkdir(path.join(root, 'workspace'));
  await fs.writeFile(path.join(root, 'workspace/图片 #%.PNG'), png);
  http = new HttpServer({ staticDir: root });
  registerFsRoutes(http, new FileStore(path.join(root, 'workspace')));
  await http.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterEach(async () => { await http.close(); await fs.rm(root, { recursive: true, force: true }); });
const imageUrl = (name: string) => `${base}/api/image?path=${encodeURIComponent(name)}`;

test('图片内联响应保留原始字节和文件名，HEAD / Range 与下载一致', async () => {
  const url = imageUrl('图片 #%.PNG');
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('content-disposition')!, /^inline;/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(png.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const part = await fetch(url, { headers: { Range: 'bytes=8-15', 'If-Range': head.headers.get('etag')! } });
  assert.equal(part.status, 206);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), png.subarray(8, 16));
  const download = await fetch(`${base}/api/download?path=${encodeURIComponent('图片 #%.PNG')}`);
  assert.match(download.headers.get('content-disposition')!, /^attachment;/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
});

test('支持常见图片 MIME；SVG 直接打开也限制脚本和外部资源', async () => {
  for (const [ext, mime] of Object.entries({ jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/vnd.microsoft.icon', apng: 'image/apng', svg: 'image/svg+xml' })) {
    await fs.writeFile(path.join(root, `workspace/a.${ext}`), ext === 'svg' ? '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' : png);
    const response = await fetch(imageUrl(`a.${ext}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), mime);
    assert.match(response.headers.get('content-security-policy')!, /sandbox; default-src 'none'/);
    await response.arrayBuffer();
  }
});

test('缺失文件、目录、非图片、路径越界及符号链接逃逸均不能作为图片打开', async () => {
  await fs.mkdir(path.join(root, 'workspace/folder.png'));
  await fs.writeFile(path.join(root, 'outside.png'), png);
  await fs.symlink(path.join(root, 'outside.png'), path.join(root, 'workspace/link.png'));
  await fs.writeFile(path.join(root, 'workspace/a.html'), '<script>alert(1)</script>');
  for (const [name, status] of [['missing.png', 404], ['folder.png', 400], ['a.html', 415], ['../outside.png', 400], ['link.png', 400]] as const) {
    assert.equal((await fetch(imageUrl(name))).status, status, name);
  }
  assert.equal((await fetch(`${base}/api/image`)).status, 400);
});
