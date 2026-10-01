import { extractArchive, type ArchiveBlob } from './archive-sessions.ts';
import { isArchiveFile } from './archive.ts';
import { isImageFile } from './image.ts';

export type ArchiveDocument = { release: () => void; name: string; blob: Blob; url: string; content?: string; truncated?: boolean; kind: 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'binary'; mime: string };
const mediaTypes: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg',
};
async function inspect(name: string, value: ArchiveBlob): Promise<ArchiveDocument> {
  const { blob, release } = value;
  const extension = name.split('.').pop()!.toLowerCase();
  const mime = mediaTypes[extension] ?? (extension === 'pdf' ? 'application/pdf' : extension === 'svg' ? 'image/svg+xml' : 'application/octet-stream');
  let kind: ArchiveDocument['kind'] = isImageFile(name) ? 'image' : extension === 'pdf' ? 'pdf' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'binary';
  let text: string | undefined;
  const limit = 1024 * 1024;
  if (kind === 'binary' && !isArchiveFile(name)) {
    const sample = new Uint8Array(await blob.slice(0, limit).arrayBuffer());
    if (!sample.some((byte) => byte === 0 || (byte < 9) || (byte > 13 && byte < 32))) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: blob.size > limit }); kind = 'text'; } catch { /* Binary download only. */ }
    }
  }
  return { release, name, blob, url: URL.createObjectURL(blob.slice(0, blob.size, mime)), content: text, truncated: kind === 'text' && blob.size > limit, kind, mime };
}

/** Materialize a virtual file; presentation belongs to the regular document view. */
export async function loadArchiveFile(root: string, chain: string[], name: string, password?: string): Promise<ArchiveDocument> {
  const value = await extractArchive(root, name, password, chain);
  try { return await inspect(name, value); }
  catch (error) { value.release(); throw error; }
}
export function releaseArchiveFile(value: ArchiveDocument) {
  URL.revokeObjectURL(value.url);
  value.release();
}
