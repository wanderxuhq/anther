export type ArchiveEntry = { id: number; path: string; sourcePath?: string; directory: boolean; size: number; encrypted: boolean; link: boolean };
export type ArchiveLimits = { maxDepth: number; maxBufferedBytes: number };
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = { maxDepth: 3, maxBufferedBytes: 128 * 1024 * 1024 };
// NUL is rejected by archivePath, so it is a safe separator for the root and
// every chain element. No JSON parsing is needed for archive identities.
const ARCHIVE_KEY_SEPARATOR = '\0';
export function archiveChainKey(chain: readonly string[]): string {
  return chain.join(ARCHIVE_KEY_SEPARATOR);
}
export function archiveChainFromKey(key: string): string[] {
  return key === '' ? [] : key.split(ARCHIVE_KEY_SEPARATOR);
}
export const archiveKey = (root: string, chain: string[] = []) => `${root}${ARCHIVE_KEY_SEPARATOR}${archiveChainKey(chain)}`;
export function archiveRootOf(key: string): string {
  const separator = key.indexOf(ARCHIVE_KEY_SEPARATOR);
  return separator < 0 ? key : key.slice(0, separator);
}
/** UI grouping key: same archive/chain, with budget failures grouped per archive root. */
export function archiveFeedbackKey(root: string, chain: string[] = [], limit?: 'depth' | 'budget'): string {
  return limit === 'budget' ? `${archiveKey(root)}\0budget` : archiveKey(root, chain);
}

export function archiveChainOf(key: string): string[] {
  const separator = key.indexOf(ARCHIVE_KEY_SEPARATOR);
  if (separator < 0) return [];
  return archiveChainFromKey(key.slice(separator + 1)).filter(Boolean);
}
export type ArchiveRequest = { id: number; action: 'open' | 'extract'; url?: string; path?: string; entry?: number; password?: string; chain?: string[]; passwords?: (string | undefined)[]; limits?: ArchiveLimits; heldBytes?: number };
export type ArchiveReply = { id: number; entries?: ArchiveEntry[]; blob?: Blob; error?: string; passwordRequired?: boolean; passwordDepth?: number; limit?: 'depth' | 'budget'; progress?: number };

export const isZipFile = (path: string) => /\.(zip|jar|war|apk|xpi|cbz)$/i.test(path);
export const isArchiveFile = (path: string) => isZipFile(path) || /\.(7z|rar|tar|gz|tgz|bz2|tbz2?|xz|txz)$/i.test(path);

// Treat names as archive-relative paths, never as links into the workspace.
export function archivePath(name: string): string | null {
  const value = name.replace(/\\/g, '/');
  if (!value || value.startsWith('/') || /^[a-z]:/i.test(value) || /[\0-\x1f\x7f]/.test(value)) return null;
  const parts = value.split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) return null;
  return parts.join('/') || null;
}

export function parseSevenZipListing(output: string): ArchiveEntry[] {
  // -slt includes an archive header before the dashed separator.
  const body = output.split(/^----------\s*$/m).slice(1).join('\n');
  if (!body.trim()) return [];
  return body.trim().split(/\r?\n\s*\r?\n/).flatMap((block, id) => {
    const fields = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const match = /^(.+?) =(?: (.*))?$/.exec(line);
      if (!match || fields.has(match[1])) throw new Error('Unsupported archive filename');
      fields.set(match[1], match[2] ?? '');
    }
    const original = fields.get('Path') ?? '';
    const normalized = archivePath(original);
    const size = Number(fields.get('Size') || 0);
    const directory = fields.get('Folder') === '+' || (fields.get('Attributes') ?? '').startsWith('D');
    if (directory && /^\.?\/?$/.test(original)) return [];
    if (!normalized || !Number.isSafeInteger(size) || size < 0) throw new Error('Unsupported archive entry');
    return [{ id, path: normalized, ...(!directory && original !== normalized ? { sourcePath: original } : {}), directory,
      size, encrypted: fields.get('Encrypted') === '+', link: !!fields.get('Symbolic Link') || !!fields.get('Hard Link') || /(?:^|\s)l[rwx-]{9}/.test(fields.get('Mode') ?? '') }];
  });
}

export function archiveChildren(entries: ArchiveEntry[], directory: string, limit = 201): ArchiveEntry[] {
  const prefix = directory ? `${directory}/` : '';
  const folders = new Map<string, ArchiveEntry>();
  const files: ArchiveEntry[] = [];
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix) || entry.path === directory) continue;
    const remaining = entry.path.slice(prefix.length), slash = remaining.indexOf('/');
    if (slash >= 0 || entry.directory) {
      const path = slash >= 0 ? prefix + remaining.slice(0, slash) : entry.path;
      folders.set(path, { ...entry, id: -1, path, directory: true });
    } else files.push(entry);
    if (folders.size + files.length >= limit) break;
  }
  return [...folders.values(), ...files].sort((a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path) || a.id - b.id);
}
