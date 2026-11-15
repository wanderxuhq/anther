import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldKind } from './form-field.ts';

test('fieldKind picks exactly one rendering branch', () => {
  assert.equal(fieldKind({ type: 'external' }), 'external');
  assert.equal(fieldKind({ type: 'boolean' }), 'boolean');
  assert.equal(fieldKind({ type: 'multiselect', options: [{ value: 'a', label: 'A' }] }), 'multiselect');
  assert.equal(fieldKind({ type: 'string', options: [{ value: 'a', label: 'A' }] }), 'select');
  assert.equal(fieldKind({ type: 'string', options: [] }), 'input');
  assert.equal(fieldKind({ type: 'string' }), 'input');
  assert.equal(fieldKind({ type: 'number' }), 'input');
  assert.equal(fieldKind({ type: 'integer' }), 'input');
  assert.equal(fieldKind({ type: 'mystery' }), 'input');
});

test('fieldKind keeps external/boolean precedence over options', () => {
  assert.equal(fieldKind({ type: 'external', options: [{ value: 'a', label: 'A' }] }), 'external');
  assert.equal(fieldKind({ type: 'boolean', options: [{ value: 'a', label: 'A' }] }), 'boolean');
});
