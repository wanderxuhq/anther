// web/src/agent/config.ts
// Pure helpers for ACP session config options.
import type { AgentModeState, ConfigOption, ConfigOptionChoice, ConfigOptionGroup, Model } from './api.ts';

/** Resolve the session's current model option to an available model. */
export function modelFromConfig(
  options: readonly ConfigOption[] | null | undefined,
  models: readonly Model[],
): Model | null {
  const option = modelConfigOption(options);
  if (!option || typeof option.currentValue !== 'string') return null;
  const [providerID, ...rest] = option.currentValue.split('/');
  return models.find((model) => model.providerID === providerID && model.id === rest.join('/')) ?? null;
}

/** The ACP config option that represents the session model, regardless of its id. */
export function modelConfigOption(options: readonly ConfigOption[] | null | undefined): ConfigOption | undefined {
  return options?.find((option) => option.type === 'select'
    && (option.id === 'model' || option.category === 'model'));
}

/** Options that belong in the generic session-settings menu. */
export function secondaryConfigOptions(options: readonly ConfigOption[] | null | undefined): ConfigOption[] {
  return (options ?? []).filter((option) => {
    if (option.type !== 'select' && option.type !== 'boolean') return false;
    if (option.category === 'model' || option.id === 'model') return false;
    if (option.category === 'mode' || option.id === 'mode') return false;
    return true;
  });
}

/** The reasoning-effort style option that gets its own composer button. */
export function effortConfigOption(options: readonly ConfigOption[] | null | undefined): ConfigOption | undefined {
  return secondaryConfigOptions(options).find((option) => option.type === 'select' && (
    option.id === 'thought_level'
    || option.category === 'thought_level'
    || /effort/i.test(option.id)
    || /effort/i.test(option.name)
    || /thought/i.test(option.id)
    || /thought/i.test(option.name)
  ));
}

/** Session settings that stay in the generic settings popover. */
export function otherConfigOptions(options: readonly ConfigOption[] | null | undefined): ConfigOption[] {
  const effort = effortConfigOption(options);
  return secondaryConfigOptions(options).filter((option) => option.id !== effort?.id);
}

/** Flatten flat or grouped select choices. */
export function configChoices(option: ConfigOption): ConfigOptionChoice[] {
  return flattenChoices(option.options);
}

/** Derive the mode selector state from a session's config options. */
export function modeStateFromOptions(options: readonly ConfigOption[] | null | undefined): AgentModeState | null {
  const option = options?.find((entry) =>
    entry.type === 'select' && (entry.category === 'mode' || entry.id === 'mode'));
  if (!option || typeof option.currentValue !== 'string') return null;

  const choices = flattenChoices(option.options);
  if (choices.length === 0) return null;
  return {
    currentModeId: option.currentValue,
    availableModes: choices.map((choice) => ({
      id: choice.value,
      name: choice.name,
      description: choice.description ?? undefined,
    })),
  };
}

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

/** Where a config snapshot should be applied: live session, draft, or inactive session. */
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

/** Whether a mode change should also replace the draft defaults. */
export function planModeApply(target: ConfigTarget, source: ConfigSource): { updateDefaultModes: boolean } {
  // The menu's explicit choice also teaches new chats; server pushes only follow
  // the draft (live/background sessions keep the defaults they already had).
  return { updateDefaultModes: target === 'draft' || (target === 'current' && source === 'menu') };
}

function flattenChoices(options: ConfigOption['options']): ConfigOptionChoice[] {
  if (!options) return [];
  const choices: ConfigOptionChoice[] = [];
  for (const entry of options) {
    if ('group' in entry) {
      choices.push(...(entry as ConfigOptionGroup).options);
    } else {
      choices.push(entry as ConfigOptionChoice);
    }
  }
  return choices;
}
