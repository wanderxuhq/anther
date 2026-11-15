import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expireKeyBarFocus,
  initialKeyBarFocus,
  prepareKeyBarFocus,
  restoreKeyBarFocus,
  settleKeyBarFocus,
} from './key-bar-focus.ts';

test('pointerdown without input focus changes nothing and arms no fallback', () => {
  const state = initialKeyBarFocus();
  const step = prepareKeyBarFocus(state, false);
  assert.equal(step.state, state);
  assert.equal(step.armFallback, false);
  assert.equal(step.refocusNow, false);
});

test('pointerdown with input focus records restore + suppression and arms the fallback', () => {
  const step = prepareKeyBarFocus(initialKeyBarFocus(), true);
  assert.deepEqual(step.state, { restoreInput: true, suppressTracking: true });
  assert.equal(step.armFallback, true);
  assert.equal(step.refocusNow, false);
});

test('click refocuses immediately, replaces the fallback with the deferred settle', () => {
  const step = restoreKeyBarFocus({ restoreInput: true, suppressTracking: true });
  assert.deepEqual(step.state, { restoreInput: true, suppressTracking: true });
  assert.equal(step.refocusNow, true);
  assert.equal(step.scheduleSettle, true);
  assert.equal(step.clearTimer, true);
  assert.equal(step.armFallback, false);
});

test('deferred settle refocuses once and clears both flags', () => {
  const settled = settleKeyBarFocus({ restoreInput: true, suppressTracking: true });
  assert.equal(settled.refocus, true);
  assert.deepEqual(settled.state, { restoreInput: false, suppressTracking: false });
});

test('settle without recorded input focus releases suppression without refocusing', () => {
  const settled = settleKeyBarFocus({ restoreInput: false, suppressTracking: true });
  assert.equal(settled.refocus, false);
  assert.deepEqual(settled.state, { restoreInput: false, suppressTracking: false });
});

test('a click without a preceding pointerdown is a no-op', () => {
  const step = restoreKeyBarFocus(initialKeyBarFocus());
  assert.equal(step.refocusNow, false);
  assert.equal(step.scheduleSettle, false);
  assert.equal(step.clearTimer, false);
});

test('fallback expires the gesture without refocusing', () => {
  assert.deepEqual(expireKeyBarFocus(), { restoreInput: false, suppressTracking: false });
});
