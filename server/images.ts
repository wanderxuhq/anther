import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FileStore } from './files.ts';
import { HttpError } from './http-error.ts';
import { sendOpenedDownload } from './download.ts';

const TYPES: Record<string, string> = {
  '.png': 'image/png', '.apng': 'image/apng', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.ico': 'image/vnd.microsoft.icon', '.svg': 'image/svg+xml',
};

export async function sendImage(files: FileStore, req: IncomingMessage, res: ServerResponse, query: URLSearchParams) {
  const filename = query.get('path');
  if (!filename) throw new HttpError(400, 'missing path');
  const contentType = TYPES[path.extname(filename).toLowerCase()];
  if (!contentType) throw new HttpError(415, 'unsupported image type');
  const source = await files.openDownload(filename);
  // SVG 也可能被直接导航打开：限制脚本和外部资源，不赋予工作区文件应用权限。
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  await sendOpenedDownload(source, path.basename(filename), req, res, { contentType, disposition: 'inline' });
}
