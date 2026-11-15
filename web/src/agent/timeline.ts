// web/src/agent/timeline.ts
// Pure incremental reducer for the ACP session timeline. Replays are only used
// when a session is opened; live updates patch the existing items in place.
import type { PromptContent } from './api.ts';
import { richContent, type RichContent } from './content.ts';
import { planEntries, upsertPlan, type PlanItem } from './plan.ts';
import {
  applyCompactionChunk,
  applyCompactionUpdate,
  noticeItem,
  type StatusItem,
} from './status.ts';
import { terminalIdsFromContent } from './terminal.ts';

export type ToolStatus = 'streaming' | 'running' | 'completed' | 'error';
export type ToolFile = { uri: string; mime: string; name?: string | null };
export type ToolItem = {
  id: string;
  name: string;
  status: ToolStatus;
  input: string;
  inputObject?: unknown;
  content: string;
  rich: RichContent[];
  terminalIds: string[];
  files: ToolFile[];
  metadata?: Record<string, unknown>;
  error?: string;
  time?: { created?: number; ran?: number; completed?: number };
};
export type Tokens = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
};
export type Usage = { cost?: number; tokens?: Tokens };
export type UserItem = {
  kind: 'user';
  id: string;
  text: string;
  rich: RichContent[];
  content: PromptContent[];
  time: number;
};
export type AssistantItem = {
  kind: 'assistant';
  id: string;
  text: string;
  reasoning: string;
  rich: RichContent[];
  tools: ToolItem[];
  time: number;
  model?: string;
  agent?: string;
  usage?: Usage;
  error?: string;
};
export type ChatItem = UserItem | AssistantItem | PlanItem | StatusItem;

export type TimelineState = {
  items: ChatItem[];
  tools: Map<string, ToolItem>;
  toolOwners: Map<string, AssistantItem>;
  assistant: AssistantItem | null;
  assistantID: string | null;
  user: UserItem | null;
  userID: string | null;
  updateIndex: number;
};

let localID = 0;
export const nextTimelineId = (prefix: string) => `${prefix}-${++localID}`;

export function createTimeline(): TimelineState {
  return {
    items: [],
    tools: new Map(),
    toolOwners: new Map(),
    assistant: null,
    assistantID: null,
    user: null,
    userID: null,
    updateIndex: 0,
  };
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function acpContentText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  const value = content as { type?: unknown; text?: unknown };
  return value.type === 'text' ? String(value.text ?? '') : '';
}

function acpToolText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const value = part as Record<string, any>;
    if (value.type === 'content') {
      const text = acpContentText(value.content);
      if (text) parts.push(text);
    } else if (value.type === 'diff') {
      parts.push(`--- ${value.path}\n+++ ${value.path}\n${value.oldText ?? ''}\n${value.newText ?? ''}`);
    } else if (value.type === 'terminal') {
      // Rendered from the live terminal output panel.
    }
  }
  return parts.join('\n');
}

function acpToolFiles(content: unknown, locations?: unknown): ToolFile[] {
  const files: ToolFile[] = [];
  for (const part of Array.isArray(content) ? content : []) {
    const value = part as Record<string, any>;
    if (value?.type === 'file' && typeof value.uri === 'string') {
      files.push({ uri: value.uri, mime: String(value.mime ?? ''), name: value.name ?? null });
    }
  }
  for (const location of Array.isArray(locations) ? locations : []) {
    const value = location as { path?: unknown };
    if (typeof value?.path === 'string' && !files.some((file) => file.uri === value.path)) {
      files.push({ uri: value.path, mime: '', name: value.path.split('/').pop() ?? value.path });
    }
  }
  return files;
}

function acpToolRich(content: unknown): RichContent[] {
  if (!Array.isArray(content)) return [];
  const rich: RichContent[] = [];
  for (const part of content) {
    const value = part as Record<string, any>;
    if (value?.type === 'content') {
      const item = richContent(value.content);
      if (item) rich.push(item);
    }
  }
  return rich;
}

function acpToolStatus(status: unknown): ToolStatus {
  if (status === 'pending') return 'streaming';
  if (status === 'in_progress') return 'running';
  if (status === 'failed') return 'error';
  return 'completed';
}

function acpTool(update: any): ToolItem {
  return {
    id: String(update.toolCallId ?? update.id ?? nextTimelineId('tool')),
    name: String(update.name || update.title || 'tool'),
    status: acpToolStatus(update.status),
    input: stringify(update.rawInput),
    inputObject: update.rawInput,
    content: acpToolText(update.content),
    rich: acpToolRich(update.content),
    terminalIds: terminalIdsFromContent(update.content),
    files: acpToolFiles(update.content, update.locations),
    metadata: update.rawOutput,
  };
}

function replaceItem(state: TimelineState, previous: ChatItem, next: ChatItem): void {
  state.items = state.items.map((item) => item === previous ? next : item);
}

function setAssistant(state: TimelineState, previous: AssistantItem | null, next: AssistantItem): void {
  state.assistant = next;
  state.assistantID = next.id;
  if (previous) replaceItem(state, previous, next);
  else state.items = [...state.items, next];
  for (const tool of next.tools) state.toolOwners.set(tool.id, next);
}

function ensureAssistant(state: TimelineState, now: number, id?: string): AssistantItem {
  const current = state.assistant;
  if (current && (!id || !state.assistantID || id === state.assistantID)) return current;
  const item: AssistantItem = {
    kind: 'assistant',
    id: id || nextTimelineId('assistant'),
    text: '',
    reasoning: '',
    rich: [],
    tools: [],
    time: now,
  };
  setAssistant(state, null, item);
  return item;
}

function ensureUser(state: TimelineState, now: number, id: string): UserItem {
  if (state.user && (!state.userID || id === state.userID)) return state.user;
  const item: UserItem = { kind: 'user', id, text: '', rich: [], content: [], time: now };
  state.items = [...state.items, item];
  state.user = item;
  state.userID = id;
  state.assistant = null;
  state.assistantID = null;
  return item;
}

function replaceTool(state: TimelineState, previous: ToolItem, next: ToolItem): void {
  state.tools.set(next.id, next);
  const owner = state.toolOwners.get(previous.id);
  if (!owner) return;
  const nextOwner: AssistantItem = {
    ...owner,
    tools: owner.tools.map((tool) => tool === previous ? next : tool),
  };
  if (state.assistant === owner) state.assistant = nextOwner;
  for (const tool of nextOwner.tools) state.toolOwners.set(tool.id, nextOwner);
  replaceItem(state, owner, nextOwner);
}

/** Apply one `sessionUpdate` payload; returns the same state for convenient chaining. */
export function applyTimelineUpdate(state: TimelineState, raw: unknown, now = Date.now()): TimelineState {
  if (!raw || typeof raw !== 'object') return state;
  const update = raw as Record<string, any>;
  state.updateIndex += 1;
  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      const id = String(update.messageId ?? nextTimelineId('user'));
      const current = ensureUser(state, now, id);
      const rich = richContent(update.content);
      const next: UserItem = {
        ...current,
        text: current.text + acpContentText(update.content),
        rich: rich ? [...current.rich, rich] : current.rich,
        content: update.content && typeof update.content === 'object'
          ? [...current.content, update.content as PromptContent]
          : current.content,
      };
      state.user = next;
      replaceItem(state, current, next);
      break;
    }
    case 'agent_message_chunk': {
      state.user = null;
      state.userID = null;
      const text = acpContentText(update.content);
      const rich = richContent(update.content);
      if (!text && !rich) break;
      const id = String(update.messageId ?? '').replace(/:reasoning:\d+$/, '') || undefined;
      const current = ensureAssistant(state, now, id);
      const next: AssistantItem = {
        ...current,
        text: current.text + text,
        rich: rich ? [...current.rich, rich] : current.rich,
      };
      setAssistant(state, current, next);
      break;
    }
    case 'agent_thought_chunk': {
      state.user = null;
      state.userID = null;
      const text = acpContentText(update.content);
      if (!text) break;
      const id = String(update.messageId ?? '').replace(/:reasoning:\d+$/, '') || undefined;
      const current = ensureAssistant(state, now, id);
      setAssistant(state, current, { ...current, reasoning: current.reasoning + text });
      break;
    }
    case 'tool_call': {
      state.user = null;
      state.userID = null;
      const tool = acpTool(update);
      const existing = state.tools.get(tool.id);
      if (existing) {
        replaceTool(state, existing, { ...existing, ...tool });
        break;
      }
      const owner = ensureAssistant(state, now);
      const nextOwner: AssistantItem = { ...owner, tools: [...owner.tools, tool] };
      state.tools.set(tool.id, tool);
      setAssistant(state, owner, nextOwner);
      break;
    }
    case 'tool_call_update': {
      const tool = state.tools.get(String(update.toolCallId));
      if (!tool) break;
      const next: ToolItem = { ...tool };
      if (update.status !== undefined) next.status = acpToolStatus(update.status);
      if (update.title !== undefined) next.name = String(update.title ?? next.name);
      if (update.name !== undefined) next.name = String(update.name ?? next.name);
      if (update.content !== undefined) {
        next.content = acpToolText(update.content);
        next.rich = acpToolRich(update.content);
        next.terminalIds = terminalIdsFromContent(update.content);
      }
      if (update.locations !== undefined) next.files = acpToolFiles(update.content, update.locations);
      if (update.rawInput !== undefined) { next.inputObject = update.rawInput; next.input = stringify(update.rawInput); }
      if (update.rawOutput !== undefined) next.metadata = update.rawOutput;
      replaceTool(state, tool, next);
      break;
    }
    case 'usage_update': {
      const current = ensureAssistant(state, now);
      const next: AssistantItem = {
        ...current,
        usage: {
          cost: typeof update.cost?.amount === 'number' ? update.cost.amount : current.usage?.cost,
          tokens: {
            input: Number(update.used ?? 0),
            output: 0,
            reasoning: current.usage?.tokens?.reasoning,
          },
        },
      };
      setAssistant(state, current, next);
      break;
    }
    case 'notice': {
      const item = noticeItem(update, now, `notice-${state.updateIndex}`);
      if (item) state.items = [...state.items, item];
      break;
    }
    case 'compaction_update':
      state.items = applyCompactionUpdate(state.items, update, now);
      break;
    case 'compaction_summary_chunk':
      state.items = applyCompactionChunk(state.items, update, now);
      break;
    case 'plan': {
      const entries = planEntries(update);
      if (!entries) break;
      const plan: PlanItem = { kind: 'plan', id: 'plan', entries, time: now };
      state.items = upsertPlan(state.items, plan);
      state.assistant = null;
      state.assistantID = null;
      state.user = null;
      state.userID = null;
      break;
    }
    default:
      break;
  }
  return state;
}

/** Fold a history response once, then keep applying live updates incrementally. */
export function replayTimeline(updates: readonly unknown[], now = Date.now()): TimelineState {
  const state = createTimeline();
  for (const update of updates) applyTimelineUpdate(state, update, now);
  return state;
}

/** Attach the turn usage reported by `prompt_done` to the latest assistant item. */
export function applyTurnUsage(state: TimelineState, usage: Usage): TimelineState {
  let index = -1;
  for (let i = state.items.length - 1; i >= 0; i--) {
    if (state.items[i].kind === 'assistant') { index = i; break; }
  }
  if (index < 0) return state;
  const item = state.items[index] as AssistantItem;
  const next = { ...item, usage };
  if (state.assistant === item) state.assistant = next;
  for (const tool of next.tools) state.toolOwners.set(tool.id, next);
  state.items = [...state.items];
  state.items[index] = next;
  return state;
}
