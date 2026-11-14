// web/src/agent/config.ts
// Pure helpers for ACP session config options.
import type { AgentModeState, ConfigOption, ConfigOptionChoice, ConfigOptionGroup } from './api.ts';

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
