// web/src/agent/skill-command.ts
// Slash-command helpers for installed agent skills.
import type { InstalledSkill } from './api.ts';

export type SkillCommand = {
  name: string;
  description: string;
  skill: string;
};

/** Render installed skills as `/skill:<id>` commands. */
export function skillCommands(
  skills: readonly InstalledSkill[],
  fallbackDescription = 'Use this skill',
): SkillCommand[] {
  return skills
    .filter((skill) => typeof skill.name === 'string' && skill.name.trim() !== '')
    .map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description?.trim() || fallbackDescription,
      skill: skill.name,
    }));
}

/** Insert an OpenCode-style skill mention into the prompt. */
export function skillMention(name: string, task = ''): string {
  return `@${name}${task ? ` ${task}` : ' '}`;
}

/** Parse `/skill:<id> [task]` for a known installed skill. */
export function skillSlashInput(
  value: string,
  skills: readonly InstalledSkill[],
): { name: string; task: string } | null {
  const match = /^\/skill:(\S+)(?:\s+([\s\S]*))?$/.exec(value.trim());
  if (!match) return null;
  const name = match[1];
  if (!skills.some((skill) => skill.name === name)) return null;
  return { name, task: match[2]?.trim() ?? '' };
}
