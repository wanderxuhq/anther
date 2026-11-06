import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyToSequence, pasteInput } from './input.ts';

const key = (value: string, extra: Partial<Parameters<typeof keyToSequence>[0]> = {}) => ({
  key: value, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra,
});

test('keyToSequence：常用特殊键', () => {
  assert.equal(keyToSequence(key('Enter')), '\r');
  assert.equal(keyToSequence(key('Backspace')), '\x7f');
  assert.equal(keyToSequence(key('Escape')), '\x1b');
  assert.equal(keyToSequence(key('Tab')), '\t');
  assert.equal(keyToSequence(key('Tab', { shiftKey: true })), '\x1b[Z');
  assert.equal(keyToSequence(key('ArrowUp')), '\x1b[A');
  assert.equal(keyToSequence(key('ArrowUp'), true), '\x1bOA');
  assert.equal(keyToSequence(key('PageDown')), '\x1b[6~');
});

test('keyToSequence：Ctrl/Alt 组合与浏览器快捷键', () => {
  assert.equal(keyToSequence(key('c', { ctrlKey: true })), '\x03');
  assert.equal(keyToSequence(key('[', { ctrlKey: true })), '\x1b');
  assert.equal(keyToSequence(key('x', { altKey: true })), '\x1bx');
  assert.equal(keyToSequence(key('Backspace', { altKey: true })), '\x1b\x7f');
  assert.equal(keyToSequence(key('c', { metaKey: true })), null);
  assert.equal(keyToSequence(key('c', { ctrlKey: true, shiftKey: true })), null);
  assert.equal(keyToSequence(key('a')), null);
});

test('pasteInput：bracketed paste 包裹并清理伪造结束符', () => {
  assert.equal(pasteInput('hello', false), 'hello');
  assert.equal(pasteInput('hello', true), '\x1b[200~hello\x1b[201~');
  assert.equal(pasteInput('a\x1b[201~b', true), '\x1b[200~ab\x1b[201~');
});
