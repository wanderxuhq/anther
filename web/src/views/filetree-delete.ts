// web/src/views/filetree-delete.ts
// Two-tap delete confirmation: first tap arms a path for DELETE_CONFIRM_MS,
// tapping the same path confirms, any other tap re-arms. Timers are injected so
// the state machine stays synchronous and testable.
import type { Scheduler } from '../transient-state.ts';

export const DELETE_CONFIRM_MS = 3000;

export type DeleteTapOutcome = 'armed' | 'confirmed';

export function createDeleteConfirm(
  onChange: (path: string | null) => void,
  scheduler: Scheduler,
) {
  let armed: string | null = null;
  let timer: unknown;

  const cancel = () => {
    if (timer === undefined) return;
    scheduler.cancel(timer);
    timer = undefined;
  };

  return {
    tap(path: string): DeleteTapOutcome {
      cancel();
      if (armed === path) {
        armed = null;
        onChange(null);
        return 'confirmed';
      }
      armed = path;
      onChange(path);
      timer = scheduler.schedule(() => {
        timer = undefined;
        armed = null;
        onChange(null);
      }, DELETE_CONFIRM_MS);
      return 'armed';
    },
    reset() {
      cancel();
      if (armed === null) return;
      armed = null;
      onChange(null);
    },
  };
}
