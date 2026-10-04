import { createSqliteSource } from './sqlite-source.ts';
import { fileTargetKey, type FileTarget } from '../file-target.ts';

/** Adapt a workspace file or an extracted archive entry to the same SQL engine. */
export function createDatabaseSource(target: FileTarget) {
  if (!target.archive) return createSqliteSource(target.path);
  const { path, archive: { entry, chain } } = target;
  return createSqliteSource({ key: fileTargetKey(target), load: async () => {
    const { loadArchiveFile } = await import('../archive-file.ts');
    return loadArchiveFile(path, chain, entry);
  } });
}
