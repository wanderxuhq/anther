export type DirectoryState<T> = { expanded: boolean; loaded?: T[]; loading?: boolean };
export type DirectoryLoadMode = 'load' | 'refresh';

/** Refresh only replaces the cached entries; navigation also expands and clears loading. */
export function directoryLoadedPatch<T>(mode: DirectoryLoadMode, entries: T[]): Partial<DirectoryState<T>> {
  return mode === 'refresh' ? { loaded: entries } : { expanded: true, loaded: entries, loading: false };
}

/** A failed refresh keeps the previous tree state; a failed navigation clears its spinner. */
export function directoryFailedPatch<T>(mode: DirectoryLoadMode): Partial<DirectoryState<T>> {
  return mode === 'refresh' ? {} : { loading: false };
}
