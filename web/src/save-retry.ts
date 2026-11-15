// web/src/save-retry.ts
// Autosave cadence and retry loop; exported separately so tests can shrink the
// wall-clock waits without changing the debounce/attempt semantics.

export type SaveTiming = { debounceMs: number; retryMs: number; attempts: number };

/** Tests may mutate this object (and restore it) through the harness. */
export const saveTiming: SaveTiming = { debounceMs: 1000, retryMs: 1000, attempts: 3 };

/** Write with the same retry policy as the editor: `attempts` tries, retryMs apart. */
export async function writeWithRetry(
  write: () => Promise<void>,
  timing: SaveTiming = saveTiming,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await write();
      return;
    } catch (error) {
      if (attempt >= timing.attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, timing.retryMs));
    }
  }
}
