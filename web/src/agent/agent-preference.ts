// web/src/agent/agent-preference.ts
// Remember the selected native ACP agent per workspace.
import type { DiscoveredAgent } from './api.ts';

export type AgentStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function agentRuntimeStorageKey(base: string): string {
  return `anther.agent.runtime:${base || '/'}`;
}

export function loadStoredAgent(
  storageKey: string,
  agents: readonly DiscoveredAgent[],
  storage: AgentStorage | undefined = globalThis.localStorage,
): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(storageKey);
    return value && agents.some((agent) => agent.id === value) ? value : null;
  } catch {
    return null;
  }
}

export function storeAgent(
  storageKey: string,
  agentID: string | null,
  storage: AgentStorage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    if (agentID) storage.setItem(storageKey, agentID);
    else storage.removeItem(storageKey);
  } catch {
    // Browser storage can be unavailable in private/restricted contexts.
  }
}
