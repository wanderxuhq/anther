import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandNeedsInput } from './command.ts';

test('commands without an input spec run immediately when picked', () => {
  assert.equal(commandNeedsInput({}), false);
  assert.equal(commandNeedsInput({ input: null }), false);
});

test('commands with an input hint wait for the user to finish the prompt', () => {
  assert.equal(commandNeedsInput({ input: { hint: 'query to search for' } }), true);
  assert.equal(commandNeedsInput({ input: {} }), true);
});
