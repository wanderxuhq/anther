import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpServer } from './http.ts';
import { FileStore } from './files.ts';
import { registerFsRoutes } from './routes/fs.ts';

let root: string, base: string, http: HttpServer;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'anther-preview-'));
  await fs.mkdir(path.join(root, 'workspace'));
  http = new HttpServer({ staticDir: root });
  registerFsRoutes(http, new FileStore(path.join(root, 'workspace')));
  await http.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterEach(async () => { await http.close(); await fs.rm(root, { recursive: true, force: true }); });
const write = (name: string, body: string | Buffer) => fs.writeFile(path.join(root, 'workspace', name), body);
const endpoint = (api: string, name: string) => `${base}/api/${api}?path=${encodeURIComponent(name)}`;

test('文件信息区分原生预览、UTF-8 文本和二进制，保留准确大小', async () => {
  for (const [name, body, kind] of [
    ['文档 #%.PDF', '%PDF-1.7', 'pdf'], ['a.mp3', Buffer.from([0, 255]), 'audio'],
    ['a.WEBM', Buffer.from([0, 255]), 'video'], ['config.yaml', '名称: 示例\n', 'text'],
    ['a.csv', '\ufeffname,value\r\na,1\r\n', 'text'], ['LICENSE', 'License text', 'text'],
    ['empty', '', 'text'], ['fake.txt', Buffer.from([0, 10, 50]), 'binary'],
    ['raw.bin', Buffer.from([255, 254]), 'binary'], ['archive.zip', Buffer.from('PK\x03\x04\x00\x00'), 'binary'],
    ['doc.docx', Buffer.from('PK\x03\x04\x00\x00'), 'binary'],
  ] as const) {
    await write(name, body);
    const res = await fetch(endpoint('file-info', name));
    assert.equal(res.status, 200);
    const info = await res.json() as { kind: string; size: number; modified: string };
    assert.equal(info.kind, kind, name);
    assert.equal(info.size, Buffer.byteLength(body));
    assert.ok(Number.isFinite(Date.parse(info.modified)));
  }
});

test('采样 UTF-8 字符被边界截断时仍识别为文本，不读取整个大二进制文件', async () => {
  await write('boundary.txt', 'a'.repeat(8191) + '中');
  const text = await (await fetch(endpoint('file-info', 'boundary.txt'))).json() as { kind: string };
  assert.equal(text.kind, 'text');
  const file = await fs.open(path.join(root, 'workspace/large.bin'), 'w');
  await file.truncate(512 * 1024 * 1024); // 稀疏文件，元数据探测不需要整文件缓冲。
  await file.close();
  const info = await (await fetch(endpoint('file-info', 'large.bin'))).json() as { kind: string; size: number };
  assert.equal(info.kind, 'binary');
  assert.equal(info.size, 512 * 1024 * 1024);
});

test('音视频与 PDF 提供内联流及 HEAD / Range，可读取文件后段', async () => {
  const data = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  for (const [name, mime] of [['a.mp3', 'audio/mpeg'], ['a.wav', 'audio/wav'], ['a.mp4', 'video/mp4'], ['a.webm', 'video/webm'], ['manual.PDF', 'application/pdf']] as const) {
    await write(name, data);
    const url = endpoint('preview', name);
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.headers.get('content-type'), mime);
    assert.match(head.headers.get('content-disposition')!, /^inline;/);
    assert.equal(head.headers.get('content-length'), '256');
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
    const part = await fetch(url, { headers: { Range: 'bytes=200-', 'If-Range': head.headers.get('etag')! } });
    assert.equal(part.status, 206);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), data.subarray(200));
    const download = await fetch(endpoint('download', name));
    assert.match(download.headers.get('content-disposition')!, /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), data);
  }
});

test('预览接口拒绝任意 HTML、目录和越界路径，损坏链接或缺失文件正常报错', async () => {
  await write('page.html', '<script>alert(1)</script>');
  await fs.mkdir(path.join(root, 'workspace/folder.mp4'));
  await fs.writeFile(path.join(root, 'outside.mp4'), 'outside');
  await fs.symlink(path.join(root, 'outside.mp4'), path.join(root, 'workspace/link.mp4'));
  await fs.symlink('missing.mp4', path.join(root, 'workspace/broken.mp4'));
  assert.equal((await fetch(endpoint('preview', 'page.html'))).status, 415);
  assert.equal((await fetch(endpoint('preview', 'manual.pdf'))).status, 404);
  for (const api of ['preview', 'file-info']) {
    for (const [name, status] of [['folder.mp4', 400], ['../outside.mp4', 400], ['link.mp4', 400], ['broken.mp4', 400], ['missing.mp4', 404]] as const) {
      assert.equal((await fetch(endpoint(api, name))).status, status, `${api} ${name}`);
    }
    assert.equal((await fetch(`${base}/api/${api}`)).status, 400);
  }
});
