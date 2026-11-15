// web/src/debounce.ts
// Internal restartable debounce: cancel the pending run and start a new delay.
// The callback is supplied per schedule call so callers can capture event data.

export type Debounce = {
  schedule(run: () => void): void;
  cancel(): void;
};

export function createDebounce(delayMs: number): Debounce {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    schedule(run) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, delayMs);
    },
    cancel,
  };
}
