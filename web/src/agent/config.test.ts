import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeStateFromOptions } from './config.ts';
import type { ConfigOption } from './api.ts';

function modeOption(overrides: Partial<ConfigOption> = {}): ConfigOption {
  return {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: 'build',
    options: [
      { value: 'build', name: 'Build' },
      { value: 'plan', name: 'Plan' },
    ],
    ...overrides,
  };
}

test('extracts a mode select from config options', () => {
  const state = modeStateFromOptions([modeOption()]);
  assert.deepEqual(state, {
    currentModeId: 'build',
    availableModes: [
      { id: 'build', name: 'Build', description: undefined },
      { id: 'plan', name: 'Plan', description: undefined },
    ],
  });
});

test('flattens grouped mode options', () => {
  const state = modeStateFromOptions([
    modeOption({
      options: [
        {
          group: 'main',
          name: 'Main',
          options: [
            { value: 'build', name: 'Build', description: 'Write code' },
            { value: 'plan', name: 'Plan' },
          ],
        },
      ],
    }),
  ]);
  assert.equal(state?.currentModeId, 'build');
  assert.deepEqual(state?.availableModes.map((mode) => mode.id), ['build', 'plan']);
  assert.equal(state?.availableModes[0].description, 'Write code');
});

test('returns null when there is no mode option', () => {
  assert.equal(modeStateFromOptions(undefined), null);
  assert.equal(modeStateFromOptions([]), null);
  assert.equal(modeStateFromOptions([modeOption({ category: 'model', id: 'model' })]), null);
  assert.equal(modeStateFromOptions([
    modeOption({ type: 'boolean', currentValue: true, options: undefined }),
  ]), null);
});
