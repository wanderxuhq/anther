import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FileStore } from './files.ts';
import { HttpError } from './http-error.ts';
import type { FileHandle } from 'node:fs/promises';

export type ByteRange = { start: number; end: number };
export type DownloadSource = { file: FileHandle; size: number; etag: string; modified: Date };

/** undefined 表示忽略 Range，空数组表示合法但无可满足区间（416）。 */
function byteRanges(value: string | undefined, size: number): ByteRange[] | undefined {
  if (!value) return;
  const match = /^bytes=(.*)$/i.exec(value.trim());
  if (!match) return;
  const parts = match[1].split(',').map((p) => p.trim()).filter(Boolean);
  // 忽略异常的区间集合，退回整文件；不限制文件大小或并发下载连接数。
  if (!parts.length || parts.length > 32) return;
  const length = BigInt(size);
  const ranges: (ByteRange & { order: number })[] = [];
  for (const [order, part] of parts.entries()) {
    const m = /^(\d*)-(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[2])) return;
    let start: bigint;
    let end: bigint;
    if (!m[1]) {
      const suffix = BigInt(m[2]);
      if (!suffix) continue;
      start = suffix >= length ? 0n : length - suffix;
      end = length - 1n;
    } else {
      start = BigInt(m[1]);
      end = m[2] ? BigInt(m[2]) : length - 1n;
      if (m[2] && end < start) return;
      if (end >= length) end = length - 1n;
    }
    if (start >= length) continue;
    ranges.push({ start: Number(start), end: Number(end), order });
  }
  // 合并重复、重叠、相邻区间，避免重复发送同一份文件；其余保留请求顺序。
  ranges.sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
      last.order = Math.min(last.order, range.order);
    } else merged.push({ ...range });
  }
  return merged.sort((a, b) => a.order - b.order);
}

function matchesTag(value: string, etag: string, weak = false): boolean {
  if (value.trim() === '*') return true;
  const tags = value.match(/(?:W\/)?"[^"\r\n]*"/g) ?? [];
  return tags.some((tag) => (weak ? tag.replace(/^W\//, '') : tag) === etag);
}

function matchesIfRange(value: string | undefined, etag: string): boolean {
  if (!value) return true;
  // 工作区可在同一秒内多次改写，Last-Modified 不能作为强校验器。
  // RFC 9110 §13.1.5：弱 ETag / 弱日期校验失败，回退整文件；客户端可使用提供的 ETag。
  return value === etag;
}

/** RFC 9110：HEAD、条件请求、单区间和 multipart/byteranges；每个请求独立打开文件句柄。 */
export async function sendDownload(files: FileStore, req: IncomingMessage, res: ServerResponse, q: URLSearchParams) {
  const p = q.get('path');
  if (!p) throw new HttpError(400, 'missing path');
  await sendOpenedDownload(await files.openDownload(p), path.basename(p), req, res);
}

/** 发送完成后返回本次成功传输的区间，供临时归档判断是否已完整发送。始终关闭句柄。 */
export async function sendOpenedDownload(source: DownloadSource, filename: string, req: IncomingMessage, res: ServerResponse): Promise<ByteRange[] | undefined> {
  const { file, size, etag, modified } = source;
  try {
    const name = encodeURIComponent(filename).replace(/['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    const lastModified = modified.toUTCString();
    const modifiedTime = Date.parse(lastModified);
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${name}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Last-Modified': lastModified,
    };
    const endEmpty = (status: number) => {
      res.writeHead(status, status === 304 ? headers : { ...headers, 'Content-Length': 0 });
      res.end();
    };
    // 普通前置条件先于 Range；If-Match / If-None-Match 优先于日期条件。
    const ifMatch = req.headers['if-match'];
    const unmodified = req.headers['if-unmodified-since'];
    if (ifMatch ? !matchesTag(ifMatch, etag) : unmodified && modifiedTime > Date.parse(unmodified)) {
      endEmpty(412); return;
    }
    const ifNoneMatch = req.headers['if-none-match'];
    const since = req.headers['if-modified-since'];
    if (ifNoneMatch ? matchesTag(ifNoneMatch, etag, true) : since && modifiedTime <= Date.parse(since)) {
      endEmpty(304); return;
    }
    // HEAD 只提供整文件元数据，按标准忽略 Range，不创建读取流。
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...headers, 'Content-Length': size });
      res.end(); return;
    }
    const ifRange = req.headers['if-range'];
    const ranges = matchesIfRange(Array.isArray(ifRange) ? ifRange.join(',') : ifRange, etag)
      ? byteRanges(req.headers.range, size) : undefined;
    if (ranges?.length === 0) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
      res.end(); return;
    }
    if (!ranges || ranges.length === 1) {
      const range = ranges?.[0];
      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;
      res.writeHead(range ? 206 : 200, {
        ...headers,
        'Content-Length': end - start + 1,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      });
      if (size === 0) res.end();
      else await pipeline(file.createReadStream({ start, end, autoClose: false }), res);
      return [{ start, end }];
    }
    const boundary = `anther_${randomBytes(18).toString('hex')}`;
    const parts = ranges.map((r) => Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${r.start}-${r.end}/${size}\r\n\r\n`));
    const closing = Buffer.from(`--${boundary}--\r\n`);
    const length = ranges.reduce((sum, r, i) => sum + parts[i].length + r.end - r.start + 1 + 2, closing.length);
    res.writeHead(206, { ...headers, 'Content-Type': `multipart/byteranges; boundary=${boundary}`, 'Content-Length': length });
    async function* body() {
      for (const [i, range] of ranges!.entries()) {
        yield parts[i];
        yield* file.createReadStream({ start: range.start, end: range.end, autoClose: false });
        yield Buffer.from('\r\n');
      }
      yield closing;
    }
    await pipeline(Readable.from(body()), res);
    return ranges;
  } finally {
    await file.close();
  }
}
