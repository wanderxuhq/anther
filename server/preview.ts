import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FileStore } from './files.ts';
import { HttpError } from './http-error.ts';
import { sendOpenedDownload } from './download.ts';

type MediaKind = 'audio' | 'video' | 'pdf';
const TYPES: Record<string, { kind: MediaKind; mime: string }> = {};
for (const [kind, types] of Object.entries({
  audio: { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm', aiff: 'audio/aiff' },
  video: { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg', '3gp': 'video/3gpp' },
})) for (const [extension, mime] of Object.entries(types)) TYPES[`.${extension}`] = { kind: kind as MediaKind, mime };
TYPES['.pdf'] = { kind: 'pdf', mime: 'application/pdf' };

function looksLikeText(sample: Buffer, more: boolean): boolean {
  if (sample.includes(0)) return false;
  let controls = 0;
  for (const byte of sample) if (byte < 32 && ![9, 10, 12, 13, 27].includes(byte)) controls++;
  if (controls > sample.length * 0.02) return false;
  try {
    // 只读开头；采样边界可能截断一个 UTF-8 字符，此时保留解码器未完成状态。
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: more });
    return true;
  } catch { return false; }
}

export async function inspectFile(files: FileStore, filename: string) {
  const source = await files.openDownload(filename);
  try {
    const extension = path.extname(filename).toLowerCase();
    const format = TYPES[extension];
    let kind: MediaKind | 'text' | 'binary';
    if (format) kind = format.kind;
    else {
      const sample = Buffer.alloc(Math.min(8192, source.size));
      const { bytesRead } = await source.file.read(sample, 0, sample.length, 0);
      kind = looksLikeText(sample.subarray(0, bytesRead), bytesRead < source.size) ? 'text' : 'binary';
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
