import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configChoices, effortConfigOption, modeStateFromOptions, modelConfigOption, modelFromConfig, otherConfigOptions, planConfigApply, planModeApply, secondaryConfigOptions } from './config.ts';
import type { ConfigOption, Model } from './api.ts';

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

test('finds the model option by id or category', () => {
  assert.equal(modelConfigOption(undefined), undefined);
  assert.equal(modelConfigOption([modeOption()]), undefined);
  assert.equal(modelConfigOption([modeOption({ id: 'model', category: null })])?.id, 'model');
  assert.equal(modelConfigOption([modeOption({ id: 'primary_model', category: 'model' })])?.id, 'primary_model');
});

test('hides model and mode options from the generic menu', () => {
  const options: ConfigOption[] = [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'fake/a',
      options: [{ value: 'fake/a', name: 'A' }],
    },
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: 'build',
      options: [{ value: 'build', name: 'Build' }],
    },
    {
      id: 'thought_level',
      name: 'Thought level',
      category: 'thought_level',
      type: 'select',
      currentValue: 'medium',
      options: [{ value: 'medium', name: 'Medium' }],
    },
    {
      id: 'brave_mode',
      name: 'Brave mode',
      type: 'boolean',
      currentValue: false,
    },
  ];
  assert.deepEqual(secondaryConfigOptions(options).map((option) => option.id), ['thought_level', 'brave_mode']);
});

test('flattens grouped config choices', () => {
  const choices = configChoices({
    id: 'thought_level',
    name: 'Thought level',
    type: 'select',
    currentValue: 'medium',
    options: [
      { group: 'levels', name: 'Levels', options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] },
    ],
  });
  assert.deepEqual(choices.map((choice) => choice.value), ['medium', 'high']);
});

test('picks the effort option out of the generic settings', () => {
  const options: ConfigOption[] = [
    {
      id: 'thought_level', name: 'Thought level', category: 'thought_level', type: 'select', currentValue: 'medium',
      options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }],
    },
    { id: 'brave_mode', name: 'Brave mode', type: 'boolean', currentValue: false },
  ];
  assert.equal(effortConfigOption(options)?.id, 'thought_level');
  assert.deepEqual(otherConfigOptions(options).map((option) => option.id), ['brave_mode']);
});

test('resolves the session model option to an available model', () => {
  const option = modeOption({
    id: 'model',
    category: 'model',
    currentValue: 'openai/gpt-4o',
    options: [{ value: 'openai/gpt-4o', name: 'GPT-4o' }],
  });
  const models = [
    { id: 'other', providerID: 'fake' },
    { id: 'gpt-4o', providerID: 'openai' },
  ];
  assert.equal(modelFromConfig([option], models)?.id, 'gpt-4o');
  assert.equal(modelFromConfig([option], [{ id: 'gpt-4o', providerID: 'fake' }]), null);
  assert.equal(modelFromConfig([modeOption()], models), null);
  assert.equal(modelFromConfig(undefined, models), null);
});

const models: Model[] = [{ id: 'm', providerID: 'p', name: 'M' }];

function configOptions(overrides: Partial<ConfigOption>[] = []): ConfigOption[] {
  return [
    {
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'p/m',
      options: [{ value: 'p/m', name: 'M' }],
      ...overrides[0],
    },
    {
      id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'build',
      options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }],
      ...overrides[1],
    },
  ];
}

test('current session menu update refreshes defaults but not defaultModes', () => {
  const plan = planConfigApply(configOptions(), models, 'current', 'menu');
  assert.equal(plan.updateDefaults, true);
  assert.equal(plan.updateDefaultModes, false);
  assert.equal(plan.selectModel, true);
  assert.equal(plan.model?.id, 'm');
  assert.equal(plan.modes?.currentModeId, 'build');
});

test('current session server push only mirrors the live session', () => {
  const plan = planConfigApply(configOptions(), models, 'current', 'update');
  assert.equal(plan.updateDefaults, false);
  assert.equal(plan.updateDefaultModes, false);
  assert.equal(plan.selectModel, true);
  assert.equal(plan.model?.id, 'm');
});

test('draft always refreshes defaults and defaultModes', () => {
  for (const source of ['menu', 'update'] as const) {
    const plan = planConfigApply(configOptions(), models, 'draft', source);
    assert.equal(plan.updateDefaults, true, source);
    assert.equal(plan.updateDefaultModes, true, source);
    assert.equal(plan.selectModel, true, source);
  }
});

test('background session never touches defaults or the model picker', () => {
  for (const source of ['menu', 'update'] as const) {
    const plan = planConfigApply(configOptions(), models, 'background', source);
    assert.equal(plan.updateDefaults, false, source);
    assert.equal(plan.updateDefaultModes, false, source);
    assert.equal(plan.selectModel, false, source);
    assert.equal(plan.options.length, 2);
    assert.equal(plan.modes?.currentModeId, 'build');
    assert.equal(plan.model?.id, 'm');
  }
});

test('missing model/mode options produce null plan fields', () => {
  const plan = planConfigApply([
    { id: 'effort', name: 'Effort', type: 'select', currentValue: 'high', options: [{ value: 'high', name: 'High' }] },
  ], models, 'current', 'menu');
  assert.equal(plan.model, null);
  assert.equal(plan.modes, null);
  assert.equal(plan.selectModel, true);
  assert.equal(plan.updateDefaults, true);
});

test('mode defaults follow the menu choice for current, pushes only for draft', () => {
  assert.equal(planModeApply('current', 'menu').updateDefaultModes, true);
  assert.equal(planModeApply('current', 'update').updateDefaultModes, false);
  assert.equal(planModeApply('draft', 'menu').updateDefaultModes, true);
  assert.equal(planModeApply('draft', 'update').updateDefaultModes, true);
  assert.equal(planModeApply('background', 'menu').updateDefaultModes, false);
  assert.equal(planModeApply('background', 'update').updateDefaultModes, false);
});
