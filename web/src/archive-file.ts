import { extractArchive, type ArchiveBlob } from './archive-sessions.ts';
import { isArchiveFile } from './archive.ts';
import { isImageFile } from './image.ts';
import { PREVIEW_FORMATS, looksLikeText } from '../../server/preview-formats.ts';
import { fileTargetKey } from './file-target.ts';

export type ArchiveDocument = { release: () => void; name: string; blob: Blob; url: string; content?: string; truncated?: boolean; kind: 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'binary' | 'sqlite'; mime: string };
async function inspect(name: string, value: ArchiveBlob): Promise<ArchiveDocument> {
  const { blob, release } = value;
  const extension = name.split('.').pop()!.toLowerCase();
  const format = PREVIEW_FORMATS[`.${extension}`];
  const mime = format?.mime ?? (extension === 'svg' ? 'image/svg+xml' : 'application/octet-stream');
  let kind: ArchiveDocument['kind'] = isImageFile(name) ? 'image' : format?.kind ?? 'binary';
  let text: string | undefined;
  const limit = 1024 * 1024;
  if (kind === 'binary' && !isArchiveFile(name)) {
    const sample = new Uint8Array(await blob.slice(0, limit).arrayBuffer());
    if (new TextDecoder().decode(sample.subarray(0, 16)) === 'SQLite format 3\0') kind = 'sqlite';
    else if (looksLikeText(sample, blob.size > limit)) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: blob.size > limit }); kind = 'text'; } catch { /* Binary download only. */ }
    }
  }
  return { release, name, blob, url: URL.createObjectURL(blob.slice(0, blob.size, mime)), content: text, truncated: kind === 'text' && blob.size > limit, kind, mime };
}

type SharedDocument = { promise: Promise<ArchiveDocument>; references: number };
const documents = new Map<string, SharedDocument>();
export const hasArchiveDocument = (root: string, chain: string[], name: string) => documents.has(fileTargetKey({ path: root, archive: { chain, entry: name } }));

/** Share one extracted Blob/URL between previews and trees, within the archive memory budget. */
export async function loadArchiveFile(root: string, chain: string[], name: string, password?: string): Promise<ArchiveDocument> {
  const key = fileTargetKey({ path: root, archive: { chain, entry: name } });
  let shared = documents.get(key);
  if (!shared) {
    const promise = extractArchive(root, name, password, chain).then(async (value) => {
      try { return await inspect(name, value); }
      catch (error) { value.release(); throw error; }
    });
    shared = { promise, references: 0 };
    documents.set(key, shared);
  }
  const acquired = shared;
  acquired.references++;
  try {
    const value = await acquired.promise;
    let released = false;
    return { ...value, release() {
      if (released) return;
      released = true;
      if (--acquired.references === 0) {
        if (documents.get(key) === acquired) documents.delete(key);
        URL.revokeObjectURL(value.url); value.release();
      }
    } };
  } catch (error) {
    acquired.references--;
    if (documents.get(key) === acquired) documents.delete(key);
    throw error;
  }
}
export function releaseArchiveFile(value: ArchiveDocument) { value.release(); }
