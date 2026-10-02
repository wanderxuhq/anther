import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FileStore } from './files.ts';
import { HttpError } from './http-error.ts';
import { sendOpenedDownload } from './download.ts';

import { PREVIEW_FORMATS as TYPES, looksLikeText, type MediaKind } from './preview-formats.ts';

export async function inspectFile(files: FileStore, filename: string) {
  const source = await files.openDownload(filename);
  try {
    const extension = path.extname(filename).toLowerCase();
    const format = TYPES[extension];
    let kind: MediaKind | 'text' | 'binary' | 'sqlite';
    if (format) kind = format.kind;
    else {
      const sample = Buffer.alloc(Math.min(8192, source.size));
      const { bytesRead } = await source.file.read(sample, 0, sample.length, 0);
      kind = sample.subarray(0, 16).toString() === 'SQLite format 3\0' ? 'sqlite'
        : looksLikeText(sample.subarray(0, bytesRead), bytesRead < source.size) ? 'text' : 'binary';
    }
    return { kind, size: source.size, modified: source.modified.toISOString(), mime: format?.mime ?? (kind === 'text' ? 'text/plain' : 'application/octet-stream') };
  } finally { await source.file.close(); }
}

export async function sendPreview(files: FileStore, req: IncomingMessage, res: ServerResponse, query: URLSearchParams) {
  const filename = query.get('path');
  if (!filename) throw new HttpError(400, 'missing path');
  const format = TYPES[path.extname(filename).toLowerCase()];
  if (!format) throw new HttpError(415, 'unsupported preview type');
  // 只内联已知预览类型，其他工作区文件仍只作为文本或下载提供。
  const source = await files.openDownload(filename);
  await sendOpenedDownload(source, path.basename(filename), req, res, { contentType: format.mime, disposition: 'inline' });
}
