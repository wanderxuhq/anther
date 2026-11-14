// web/src/agent/model-preference.ts
// ACP models are session-scoped; remember the user's last explicit choice in
// the browser so new chats can apply it after session/new.
import type { Model } from './api.ts';

export type ModelStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function agentModelStorageKey(base: string): string {
  return `anther.agent.model:${base || '/'}`;
}

export function modelKey(model: Pick<Model, 'providerID' | 'id'>): string {
  return `${model.providerID}/${model.id}`;
}

export function loadStoredModel(
  storageKey: string,
  models: readonly Model[],
  storage: ModelStorage | undefined = globalThis.localStorage,
): Model | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(storageKey);
    if (!value) return null;
    return models.find((model) => modelKey(model) === value) ?? null;
  } catch {
    return null;
  }
}

export function storeModel(
  storageKey: string,
  model: Model | null,
  storage: ModelStorage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    if (model) storage.setItem(storageKey, modelKey(model));
    else storage.removeItem(storageKey);
  } catch {
    // Browser storage can be unavailable in private/restricted contexts.
  }
}

export function sameModel(a: Model | null, b: Model | null): boolean {
  return a !== null
    && b !== null
    && a.providerID === b.providerID
    && a.id === b.id;
}
