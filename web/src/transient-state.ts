// web/src/transient-state.ts
// Internal helper for "show a value, clear it after N ms" state, plus the shared
// browser scheduler. Timers are injected so the state machine is synchronous.

export type Scheduler = {
  schedule(run: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
};

export const browserScheduler: Scheduler = {
  schedule: (run, delayMs) => setTimeout(run, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type TransientValue<T> = {
  show(value: T): void;
  clear(): void;
};

export function createTransientValue<T>(
  onChange: (value: T | null) => void,
  scheduler: Scheduler,
  delayMs: number,
): TransientValue<T> {
  let current: T | null = null;
  let timer: unknown;

  const cancel = () => {
    if (timer === undefined) return;
    scheduler.cancel(timer);
    timer = undefined;
  };

  return {
    show(value) {
      cancel();
      current = value;
      onChange(value);
      timer = scheduler.schedule(() => {
        timer = undefined;
        current = null;
        onChange(null);
      }, delayMs);
    },
    clear() {
      cancel();
      if (current === null) return;
      current = null;
      onChange(null);
    },
  };
}
