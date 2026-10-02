/** A file's location is independent of its preview format. */
export type ArchiveLocation = { entry: string; chain: string[] };
export type FileTarget = { path: string; archive?: ArchiveLocation };
export const fileTargetKey = (target: FileTarget) => target.archive
  ? '/-/entry/' + JSON.stringify([target.path, target.archive.chain, target.archive.entry]) : target.path;
export const fileTargetName = (target: FileTarget) => target.archive?.entry ?? target.path;
