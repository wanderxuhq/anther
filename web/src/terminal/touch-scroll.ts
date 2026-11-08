// web/src/terminal/touch-scroll.ts
// 触摸纵向滚动的事件层状态机（纯函数，便于 node:test 覆盖）：
// - 同方向位移累计到 step 像素才发一个滚轮步
// - 反向要连续累计 REVERSE_THRESHOLD 像素才真的转向，手指抖动不清零
// - 单次最多返回 MAX_STEPS，避免极端位移一次塞爆事件流

export type TouchScrollState = {
  /** 当前方向已累计的纵向像素。 */
  accum: number;
  /** 当前滚动方向：1 下拉 / -1 上推 / 0 未定。 */
  dir: 1 | -1 | 0;
  /** 反向位移的累计，用于区分抖动和真正反向。 */
  reverse: number;
  /** 方向刚切换后，还需要在新方向走多少像素才允许发送（二次确认，过滤回弹）。 */
  confirm: number;
};

export const TOUCH_REVERSE_THRESHOLD = 8;
export const TOUCH_REVERSE_CONFIRM = 8;
export const TOUCH_MAX_STEPS = 32;

export function createTouchScrollState(): TouchScrollState {
  return { accum: 0, dir: 0, reverse: 0, confirm: 0 };
}

/** 手势刚开始时，把阈值阶段累计的位移直接作为初始累计。 */
export function startTouchScroll(state: TouchScrollState, dy: number): void {
  state.accum = dy;
  state.dir = dy > 0 ? 1 : -1;
  state.reverse = 0;
  state.confirm = 0;
}

/** 吃进一次纵向位移。小抖动只忽略，不破坏已累计的滚动量。
 * 返回值表示“这一帧刚刚切换了方向”，调用方应跳过本帧的发送，
 * 避免一次回弹/坐标跳变立刻反向滚一下。 */
export function advanceTouchScroll(state: TouchScrollState, dy: number): boolean {
  if (dy === 0) return false;
  const dir = dy > 0 ? 1 : -1;
  if (state.dir === 0) state.dir = dir;
  if (dir === state.dir) {
    state.reverse = 0;
    state.accum += dy;
    // 切换方向后要再走一小段确认不是回弹，确认完才允许发送。
    if (state.confirm > 0) state.confirm = Math.max(0, state.confirm - Math.abs(dy));
    return false;
  }
  state.reverse += dy;
  if (Math.abs(state.reverse) < TOUCH_REVERSE_THRESHOLD) return false;
  // 确认反向：保留超过阈值的部分，同时要求在正确方向上再走一小段。
  state.dir = dir;
  state.accum = state.reverse - dir * TOUCH_REVERSE_THRESHOLD;
  state.reverse = 0;
  state.confirm = TOUCH_REVERSE_CONFIRM;
  return true;
}

/** 从累计量里取出整步数：正数 = 滚轮向上，负数 = 滚轮向下。 */
export function takeTouchSteps(state: TouchScrollState, step: number, maxSteps = TOUCH_MAX_STEPS): number {
  if (state.confirm > 0 || !(step > 0)) return 0;
  let steps = Math.trunc(state.accum / step);
  if (steps === 0) return 0;
  steps = Math.max(-maxSteps, Math.min(maxSteps, steps));
  state.accum -= steps * step;
  return steps;
}
