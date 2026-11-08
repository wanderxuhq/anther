import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceTouchScroll,
  createTouchScrollState,
  startTouchScroll,
  takeTouchSteps,
  TOUCH_MAX_STEPS,
  TOUCH_REVERSE_CONFIRM,
  TOUCH_REVERSE_THRESHOLD,
} from './touch-scroll.ts';

test('同方向位移累计到 step 才发一个滚轮步，余量保留', () => {
  const state = createTouchScrollState();
  startTouchScroll(state, 30);
  assert.equal(takeTouchSteps(state, 32), 0);
  assert.equal(state.accum, 30);

  advanceTouchScroll(state, 6);
  assert.equal(takeTouchSteps(state, 32), 1);
  assert.equal(state.accum, 4);
});

test('手指小幅反向抖动不会清零已累计的滚动量', () => {
  const state = createTouchScrollState();
  startTouchScroll(state, 30);

  advanceTouchScroll(state, -3);
  assert.equal(state.accum, 30);
  assert.equal(state.dir, 1);

  advanceTouchScroll(state, 6);
  assert.equal(state.accum, 36);
  assert.equal(takeTouchSteps(state, 32), 1);
});

test('连续反向超过阈值才切换方向，切换后要二次确认', () => {
  const state = createTouchScrollState();
  startTouchScroll(state, 40);

  assert.equal(advanceTouchScroll(state, -(TOUCH_REVERSE_THRESHOLD - 1)), false);
  assert.equal(state.dir, 1);
  assert.equal(state.accum, 40);

  assert.equal(advanceTouchScroll(state, -2), true);
  assert.equal(state.dir, -1);
  assert.equal(state.accum, -1);
  assert.equal(state.confirm, TOUCH_REVERSE_CONFIRM);
  assert.equal(takeTouchSteps(state, 8), 0);

  assert.equal(advanceTouchScroll(state, -8), false);
  assert.equal(state.confirm, 0);
  assert.equal(takeTouchSteps(state, 8), -1);
});

test('方向切换后新方向移动不足确认量时不发送', () => {
  const state = createTouchScrollState();
  startTouchScroll(state, 40);
  assert.equal(advanceTouchScroll(state, -9), true);
  assert.equal(state.dir, -1);
  assert.equal(state.confirm, TOUCH_REVERSE_CONFIRM);

  // 零位移或不足确认量的移动都不能把切换前的量重新发出去。
  assert.equal(advanceTouchScroll(state, 0), false);
  assert.equal(takeTouchSteps(state, 32), 0);
  assert.equal(advanceTouchScroll(state, -4), false);
  assert.equal(state.confirm, 4);
  assert.equal(takeTouchSteps(state, 32), 0);

  advanceTouchScroll(state, -4);
  assert.equal(state.confirm, 0);
  advanceTouchScroll(state, -30);
  assert.equal(takeTouchSteps(state, 32), -1);
});

test('大幅反向时保留超过阈值的位移，确认后正常取步', () => {
  const state = createTouchScrollState();
  startTouchScroll(state, 40);
  assert.equal(advanceTouchScroll(state, -40), true);
  assert.equal(state.dir, -1);
  assert.equal(state.accum, -32);
  assert.equal(takeTouchSteps(state, 32), 0);

  advanceTouchScroll(state, -8);
  assert.equal(state.confirm, 0);
  assert.equal(takeTouchSteps(state, 32), -1);
});

test('一次最多取 TOUCH_MAX_STEPS 步，剩余位移留给后续事件', () => {
  const state = createTouchScrollState();
  state.accum = 1000;
  const steps = takeTouchSteps(state, 10);
  assert.equal(steps, TOUCH_MAX_STEPS);
  assert.equal(state.accum, 1000 - TOUCH_MAX_STEPS * 10);
});

test('非法 step 不产生步数', () => {
  const state = createTouchScrollState();
  state.accum = 100;
  assert.equal(takeTouchSteps(state, 0), 0);
  assert.equal(takeTouchSteps(state, -1), 0);
  assert.equal(state.accum, 100);
});
