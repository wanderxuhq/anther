import { createSignal } from 'solid-js';

export const pathWithin = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`);
const [lockedPath, setLockedPath] = createSignal<string | null>(null);
export const fileMutationLocked = (path: string | null) => !!path && !!lockedPath() && pathWithin(path, lockedPath()!);
let beforeMutation: ((path: string) => Promise<void>) | undefined;
export function setBeforeFileMutation(handler: typeof beforeMutation) { beforeMutation = handler; }
let operations = Promise.resolve();

/** Serialize filesystem mutations and freeze affected editors while saves drain. */
export function withFileMutation(path: string, action: () => Promise<void>): Promise<void> {
  const next = operations.then(async () => {
    setLockedPath(path);
    try { await beforeMutation?.(path); await action(); }
    finally { setLockedPath(null); }
  });
  operations = next.catch(() => {});
  return next;
}
