/** A file's location is independent of its preview format. */
export type ArchiveLocation = { entry: string; chain: string[] };
export type FileTarget = { path: string; archive?: ArchiveLocation };
const ARCHIVE_KEY_PREFIX = '/_/entry/';
export const fileTargetKey = (target: FileTarget) => target.archive
  ? ARCHIVE_KEY_PREFIX + JSON.stringify([target.path, target.archive.chain, target.archive.entry]) : target.path;
/** Inverse of fileTargetKey; null preserves a malformed archive key unchanged. */
export function parseFileTargetKey(key: string): FileTarget | null {
  if (!key.startsWith(ARCHIVE_KEY_PREFIX)) return { path: key };
  try {
    const parts: unknown = JSON.parse(key.slice(ARCHIVE_KEY_PREFIX.length));
    if (!Array.isArray(parts) || parts.length !== 3) return null;
    const [path, chain, entry] = parts;
    const archive = { entry, chain };
    return typeof path === 'string' && isArchiveLocation(archive) ? { path, archive } : null;
  } catch {
    return null;
  }
}
export const fileTargetName = (target: FileTarget) => target.archive?.entry ?? target.path;
export function sameArchiveChain(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}
export function sameFileTarget(a: FileTarget, b: FileTarget): boolean {
  return fileTargetKey(a) === fileTargetKey(b);
}

export const fileTargetLabel = (target: FileTarget) => target.archive
  ? [target.path, ...target.archive.chain, target.archive.entry].join(' › ') : target.path;
/** An archive-relative entry name: never absolute, never escaping with `..`. */
export function isArchiveEntryPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    && !/^(?:[\\/]|[a-z]:)/i.test(value)
    && !value.split(/[\\/]/).includes('..');
}
export function isArchiveLocation(value: unknown): value is ArchiveLocation {
  const location = value as ArchiveLocation | undefined;
  return !!location && isArchiveEntryPath(location.entry)
    && Array.isArray(location.chain) && location.chain.every(isArchiveEntryPath);
}
