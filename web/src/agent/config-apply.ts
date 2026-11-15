// web/src/agent/config-apply.ts
// Pure decision for applying a config-option snapshot. The caller owns stores;
// this only says which defaults/model picker must be refreshed.

import type { AgentModeState, ConfigOption, Model } from './api.ts';
import { modeStateFromOptions, modelFromConfig } from './config.ts';

/** Where the session lives relative to the open chat and the draft. */
export type ConfigTarget = 'current' | 'draft' | 'background';
/** A local menu mutation vs a server-pushed config_option_update. */
export type ConfigSource = 'menu' | 'update';

export type ConfigPlan = {
  options: ConfigOption[];
  modes: AgentModeState | null;
  model: Model | null;
  /** Replace the fallback config used when no session is active. */
  updateDefaults: boolean;
  /** Replace defaultModes when `modes` is present. */
  updateDefaultModes: boolean;
  /** Push `model` into the composer picker. */
  selectModel: boolean;
};

export function planConfigApply(
  options: ConfigOption[],
  models: readonly Model[],
  target: ConfigTarget,
  source: ConfigSource,
): ConfigPlan {
  const modes = modeStateFromOptions(options);
  const model = modelFromConfig(options, models);
  if (target === 'background') {
    return { options, modes, model, updateDefaults: false, updateDefaultModes: false, selectModel: false };
  }
  const current = target === 'current';
  return {
    options,
    modes,
    model,
    // The menu already wrote defaults for the current session; server pushes are
    // only mirrored into the live session unless the draft owns the config.
    updateDefaults: current ? source === 'menu' : true,
    updateDefaultModes: !current,
    selectModel: true,
  };
}

export type ModePlan = {
  /** Replace defaultModes for the draft; live/background sessions keep theirs. */
  updateDefaultModes: boolean;
};

export function planModeApply(target: ConfigTarget, source: ConfigSource): ModePlan {
  // The menu's explicit choice also teaches new chats; server pushes only follow
  // the draft (live/background sessions keep the defaults they already had).
  return { updateDefaultModes: target === 'draft' || (target === 'current' && source === 'menu') };
}
