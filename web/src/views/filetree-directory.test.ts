import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directoryFailedPatch, directoryLoadedPatch } from './filetree-directory.ts';

test('navigation load expands the directory and clears loading', () => {
  assert.deepEqual(directoryLoadedPatch('load', ['a']), { expanded: true, loaded: ['a'], loading: false });
  assert.deepEqual(directoryFailedPatch('load'), { loading: false });
});

test('refresh only replaces loaded entries and preserves expansion/loading', () => {
  assert.deepEqual(directoryLoadedPatch('refresh', ['a']), { loaded: ['a'] });
  assert.deepEqual(directoryFailedPatch('refresh'), {});
});
