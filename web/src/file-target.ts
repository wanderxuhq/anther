/** A file's location is independent of its preview format. */
export type ArchiveLocation = { entry: string; chain: string[] };
export type FileTarget = { path: string; archive?: ArchiveLocation };
export const fileTargetKey = (target: FileTarget) => target.archive
  ? '/_/entry/' + JSON.stringify([target.path, target.archive.chain, target.archive.entry]) : target.path;
export const fileTargetName = (target: FileTarget) => target.archive?.entry ?? target.path;

export const fileTargetLabel = (target: FileTarget) => target.archive
  ? [target.path, ...target.archive.chain, target.archive.entry].join(' › ') : target.path;
export function isArchiveLocation(value: unknown): value is ArchiveLocation {
  const valid = (name: unknown): name is string => typeof name === 'string' && name.length > 0
    && !/[\u0000-\u001f\u007f-\u009f]/.test(name) && !/^(?:[\\/]|[a-z]:)/i.test(name) && !name.split(/[\\/]/).includes('..');
  const location = value as ArchiveLocation | undefined;
  return !!location && valid(location.entry) && Array.isArray(location.chain) && location.chain.every(valid);
}
