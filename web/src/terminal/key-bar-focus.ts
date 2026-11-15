// web/src/terminal/key-bar-focus.ts
// Pure state machine for the terminal key bar's focus dance. The bar must not
// steal the mobile keyboard, so pointerdown records whether the terminal input
// was focused, and click restores that focus without emitting focus tracking.
//
// Runtime timers live in the view; these functions only decide state + effects.

export type KeyBarFocusState = {
  /** The terminal input had focus when the key bar was pressed. */
  restoreInput: boolean;
  /** Keep suppressing focus/blur tracking until the deferred settle runs. */
  suppressTracking: boolean;
};

export const KEY_BAR_FOCUS_FALLBACK_MS = 2000;

export const initialKeyBarFocus = (): KeyBarFocusState => ({
  restoreInput: false,
  suppressTracking: false,
});

export type KeyBarFocusStep = {
  state: KeyBarFocusState;
  /** Focus the terminal input immediately. */
  refocusNow: boolean;
  /** Start (or restart) the fallback timer that drops the gesture. */
  armFallback: boolean;
  /** Replace the fallback timer with the deferred settle. */
  scheduleSettle: boolean;
  /** Cancel any timer owned by the previous step. */
  clearTimer: boolean;
};

/** pointerdown on the bar: remember input focus and arm the fallback. */
export function prepareKeyBarFocus(state: KeyBarFocusState, inputFocused: boolean): KeyBarFocusStep {
  if (!inputFocused) {
    return { state, refocusNow: false, armFallback: false, scheduleSettle: false, clearTimer: false };
  }
  return {
    state: { restoreInput: true, suppressTracking: true },
    refocusNow: false,
    armFallback: true,
    scheduleSettle: false,
    clearTimer: false,
  };
}

/** click on the bar: refocus now, then release suppression after the click default action. */
export function restoreKeyBarFocus(state: KeyBarFocusState): KeyBarFocusStep {
  return {
    state,
    refocusNow: state.restoreInput,
    armFallback: false,
    scheduleSettle: state.suppressTracking,
    clearTimer: state.suppressTracking,
  };
}

/** Deferred (0ms) settle: one more refocus, then release tracking suppression. */
export function settleKeyBarFocus(state: KeyBarFocusState): { state: KeyBarFocusState; refocus: boolean } {
  return { state: initialKeyBarFocus(), refocus: state.restoreInput };
}

/** Fallback timer: the click never arrived; drop the gesture without refocusing. */
export function expireKeyBarFocus(): KeyBarFocusState {
  return initialKeyBarFocus();
}
