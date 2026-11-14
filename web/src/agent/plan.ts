// web/src/agent/plan.ts
// Pure parsing/replacement helpers for ACP agent plans.

export type PlanPriority = 'high' | 'medium' | 'low';
export type PlanStatus = 'pending' | 'in_progress' | 'completed';

export type PlanEntry = {
  content: string;
  priority: PlanPriority;
  status: PlanStatus;
};

export type PlanItem = {
  kind: 'plan';
  id: 'plan';
  entries: PlanEntry[];
  time: number;
};

const PRIORITIES = new Set<string>(['high', 'medium', 'low']);
const STATUSES = new Set<string>(['pending', 'in_progress', 'completed']);

/** Parse a `sessionUpdate: "plan"` payload. Returns null for malformed payloads. */
export function planEntries(update: unknown): PlanEntry[] | null {
  if (!update || typeof update !== 'object') return null;
  const entries = (update as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return null;

  const result: PlanEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as { content?: unknown; priority?: unknown; status?: unknown };
    if (typeof value.content !== 'string' || !value.content.trim()) continue;
    result.push({
      content: value.content.trim(),
      priority: typeof value.priority === 'string' && PRIORITIES.has(value.priority)
        ? value.priority as PlanPriority
        : 'medium',
      status: typeof value.status === 'string' && STATUSES.has(value.status)
        ? value.status as PlanStatus
        : 'pending',
    });
  }
  return result;
}

/** Replace the one plan item in a timeline, or append it if none exists. */
export function upsertPlan<T extends { kind: string }>(items: readonly T[], plan: T & { kind: 'plan' }): T[] {
  const index = items.findIndex((item) => item.kind === 'plan');
  if (index < 0) return [...items, plan];
  const next = [...items];
  next[index] = plan;
  return next;
}
