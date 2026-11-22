// web/src/agent/command.ts
// Slash-command helpers for ACP commands.
import type { Command } from './api.ts';

/**
 * Commands that declare an input spec expect the user to finish the prompt
 * first. Commands without one can run as soon as they are picked.
 */
export function commandNeedsInput(command: Pick<Command, 'input'>): boolean {
  return command.input != null;
}
