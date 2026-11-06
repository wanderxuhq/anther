// web/src/terminal-keys.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_LETTERS, TERMINAL_KEYS, controlChar, keySequence } from './terminal-keys.ts';

test('keySequence：特殊键与光标键映射到标准转义序列', () => {
  assert.equal(keySequence('esc'), '\u001b');
  assert.equal(keySequence('tab'), '\t');
  assert.equal(keySequence('up'), '\u001b[A');
  assert.equal(keySequence('down'), '\u001b[B');
  assert.equal(keySequence('right'), '\u001b[C');
  assert.equal(keySequence('left'), '\u001b[D');
  assert.equal(keySequence('home'), '\u001b[H');
  assert.equal(keySequence('end'), '\u001b[F');
  assert.equal(keySequence('|'), '|');
  assert.equal(keySequence('~'), '~');
  assert.equal(keySequence('/'), '/');
  assert.equal(keySequence('-'), '-');
  assert.equal(keySequence('nope'), null);
});

test('按键条每个按钮都有对应序列', () => {
  for (const key of TERMINAL_KEYS) {
    assert.notEqual(keySequence(key.id), null, `${key.id} 缺少转义序列`);
    assert.ok(key.label.length > 0);
    assert.ok(key.aria.length > 0);
  }
});

test('controlChar：A–Z（大小写）→ 0x01–0x1A，其余 → null', () => {
  assert.equal(controlChar('c'), '\u0003');
  assert.equal(controlChar('C'), '\u0003');
  assert.equal(controlChar('d'), '\u0004');
  assert.equal(controlChar('z'), '\u001a');
  assert.equal(controlChar('a'), '\u0001');
  assert.equal(controlChar('1'), null);
  assert.equal(controlChar('ab'), null);
  assert.equal(controlChar(''), null);
});

test('CONTROL_LETTERS：全部可转换且无重复', () => {
  assert.equal(new Set(CONTROL_LETTERS).size, CONTROL_LETTERS.length);
  for (const letter of CONTROL_LETTERS) assert.notEqual(controlChar(letter), null);
});
