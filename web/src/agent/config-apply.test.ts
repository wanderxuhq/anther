import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planConfigApply, planModeApply } from './config-apply.ts';
import type { ConfigOption, Model } from './api.ts';

const models: Model[] = [{ id: 'm', providerID: 'p', name: 'M' }];

function options(overrides: Partial<ConfigOption>[] = []): ConfigOption[] {
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
  const plan = planConfigApply(options(), models, 'current', 'menu');
  assert.equal(plan.updateDefaults, true);
  assert.equal(plan.updateDefaultModes, false);
  assert.equal(plan.selectModel, true);
  assert.equal(plan.model?.id, 'm');
  assert.equal(plan.modes?.currentModeId, 'build');
});

test('current session server push only mirrors the live session', () => {
  const plan = planConfigApply(options(), models, 'current', 'update');
  assert.equal(plan.updateDefaults, false);
  assert.equal(plan.updateDefaultModes, false);
  assert.equal(plan.selectModel, true);
  assert.equal(plan.model?.id, 'm');
});

test('draft always refreshes defaults and defaultModes', () => {
  for (const source of ['menu', 'update'] as const) {
    const plan = planConfigApply(options(), models, 'draft', source);
    assert.equal(plan.updateDefaults, true, source);
    assert.equal(plan.updateDefaultModes, true, source);
    assert.equal(plan.selectModel, true, source);
  }
});

test('background session never touches defaults or the model picker', () => {
  for (const source of ['menu', 'update'] as const) {
    const plan = planConfigApply(options(), models, 'background', source);
    assert.equal(plan.updateDefaults, false, source);
    assert.equal(plan.updateDefaultModes, false, source);
    assert.equal(plan.selectModel, false, source);
    // The live session still receives the snapshot.
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
