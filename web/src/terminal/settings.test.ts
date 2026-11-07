// web/src/terminal/settings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultKeyBarOpen } from './settings.ts';

test('按键条默认值：移动端/窄屏展开，桌面端收起', () => {
  assert.equal(defaultKeyBarOpen(() => ({ matches: true })), true);
  assert.equal(defaultKeyBarOpen(() => ({ matches: false })), false);
  // Node 环境没有 window.matchMedia → 桌面默认
  assert.equal(defaultKeyBarOpen(), false);
});
