// web/src/agent/status.ts
// Pure parsing/upsert helpers for ACP notices and context compaction updates.
import { richContent, type RichContent } from './content.ts';

export type StatusTone = 'info' | 'error' | 'retry' | 'compaction' | 'warning';

export type StatusItem = {
  kind: 'system';
  id: string;
  text: string;
  detail?: string;
  textKey?: string;
  textParams?: Record<string, string | number>;
  tone: StatusTone;
  time: number;
  rich?: RichContent[];
};

type TimelineEntry = { kind: string; id: string };

const COMPACTION_PREFIX = 'compaction:';

/** Parse a live `sessionUpdate: "notice"` payload. */
export function noticeItem(update: unknown, time: number, id: string): StatusItem | null {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return null;
  const value = update as Record<string, unknown>;
  if (typeof value.title !== 'string' || !value.title.trim()) return null;
  const severity = typeof value.severity === 'string' ? value.severity : 'info';
  const tone: StatusTone = severity === 'error'
    ? 'error'
    : severity === 'warning'
      ? 'warning'
      : 'info';
  const detail = typeof value.description === 'string' && value.description.trim()
    ? value.description.trim()
    : undefined;
  return {
    kind: 'system',
    id,
    text: value.title.trim(),
    ...(detail ? { detail } : {}),
    tone,
    time,
  };
}

/**
 * Upsert a `compaction_update`. The first update fixes the timeline position;
 * later updates patch the same item in place.
 */
export function applyCompactionUpdate<T extends TimelineEntry>(
  items: readonly T[],
  update: unknown,
  now: number,
  _fallbackId: string,
): Array<T | StatusItem> {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return [...items];
  const value = update as Record<string, unknown>;
  const rawID = typeof value.compactionId === 'string' ? value.compactionId.trim() : '';
  if (!rawID) return [...items];
  const id = `${COMPACTION_PREFIX}${rawID}`;
  const index = items.findIndex((item) => item.kind === 'system' && item.id === id);
  const existing = index >= 0 ? items[index] as unknown as StatusItem : undefined;

  let detail = existing?.detail;
  let rich = existing?.rich;
  if ('summary' in value) {
    const summary = parseBlocks(value.summary);
    detail = summary.text || undefined;
    rich = summary.rich.length > 0 ? summary.rich : undefined;
  }

  const status = typeof value.status === 'string' ? value.status : 'in_progress';
  const previousError = typeof existing?.textParams?.error === 'string' || typeof existing?.textParams?.error === 'number'
    ? String(existing.textParams.error)
    : '';
  const error = Object.hasOwn(value, 'error') ? errorText(value.error) : previousError;
  let textKey = 'agent.compaction.running';
  let tone: StatusTone = 'compaction';
  let textParams: Record<string, string | number> | undefined;
  if (status === 'completed') {
    textKey = 'agent.compaction.completed';
  } else if (status === 'failed') {
    tone = 'error';
    if (error) {
      textKey = 'agent.compaction.failed';
      textParams = { error };
    } else {
      textKey = 'agent.compaction.failedGeneric';
    }
  } else if (status === 'cancelled') {
    textKey = 'agent.compaction.cancelled';
    tone = 'info';
  } else if (status !== 'in_progress') {
    textKey = 'agent.compaction.unknown';
    textParams = { status };
  }

  const next: StatusItem = {
    kind: 'system',
    id,
    text: '',
    textKey,
    ...(textParams ? { textParams } : {}),
    ...(detail ? { detail } : {}),
    ...(rich ? { rich } : {}),
    tone,
    time: existing?.time ?? now,
  };
  if (index < 0) return [...items, next];
  const copy: Array<T | StatusItem> = [...items];
  copy[index] = next;
  return copy;
}

/** Append a `compaction_summary_chunk`, creating an in-progress item if needed. */
export function applyCompactionChunk<T extends TimelineEntry>(
  items: readonly T[],
  update: unknown,
  now: number,
  _fallbackId: string,
): Array<T | StatusItem> {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return [...items];
  const value = update as Record<string, unknown>;
  const rawID = typeof value.compactionId === 'string' ? value.compactionId.trim() : '';
  if (!rawID) return [...items];
  const id = `${COMPACTION_PREFIX}${rawID}`;
  const content = value.content;
  const text = content && typeof content === 'object'
    && (content as Record<string, unknown>).type === 'text'
    && typeof (content as Record<string, unknown>).text === 'string'
    ? String((content as Record<string, unknown>).text)
    : '';
  const attachment = text ? null : richContent(content);
  if (!text && !attachment) return [...items];

  const index = items.findIndex((item) => item.kind === 'system' && item.id === id);
  const existing = index >= 0 ? items[index] as unknown as StatusItem : undefined;
  const detail = text ? `${existing?.detail ?? ''}${text}` : existing?.detail;
  const rich = attachment
    ? [...(existing?.rich ?? []), attachment]
    : existing?.rich;
  const next: StatusItem = {
    kind: 'system',
    id,
    text: '',
    textKey: existing?.textKey ?? 'agent.compaction.running',
    ...(existing?.textParams ? { textParams: existing.textParams } : {}),
    ...(detail ? { detail } : {}),
    ...(rich && rich.length > 0 ? { rich } : {}),
    tone: existing?.tone ?? 'compaction',
    time: existing?.time ?? now,
  };
  if (index < 0) return [...items, next];
  const copy: Array<T | StatusItem> = [...items];
  copy[index] = next;
  return copy;
}

function parseBlocks(value: unknown): { text: string; rich: RichContent[] } {
  if (!Array.isArray(value)) return { text: '', rich: [] };
  const text: string[] = [];
  const rich: RichContent[] = [];
  for (const block of value) {
    if (block && typeof block === 'object'
      && (block as Record<string, unknown>).type === 'text'
      && typeof (block as Record<string, unknown>).text === 'string') {
      text.push(String((block as Record<string, unknown>).text));
      continue;
    }
    const item = richContent(block);
    if (item) rich.push(item);
  }
  return { text: text.join(''), rich };
}

function errorText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value instanceof Error) return value.message.trim();
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).message === 'string') {
    return String((value as Record<string, unknown>).message).trim();
  }
  return '';
}
