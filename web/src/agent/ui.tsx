import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import {
  createApi,
  type AgentDiscovery,
  type AgentModeState,
  type Api,
  type Command,
  type DiscoveredAgent,
  type FormField,
  type FormInfo,
  type Model,
  type AgentEvent,
  type PermissionRequest,
  type Provider,
  type Session,
  type Status,
  type InstalledSkill,
  type SkillDiagnostic,
  type SkillInstallResult,
  type SkillPreview,
  type SkillTarget,
  type TerminalExit,
  type TerminalOutput,
  type AuthMethod,
  type ConfigOption,
  type PromptContent,
  type McpServer,
} from './api.ts';
import { Icon, type IconName } from './icons.tsx';
import { copyText, enhanceMarkdown, renderMarkdown } from './markdown.ts';
import {
  agentModelStorageKey,
  loadStoredModel,
  sameModel,
  storeModel,
} from './model-preference.ts';
import {
  agentRuntimeStorageKey,
  loadStoredAgent,
  storeAgent,
} from './agent-preference.ts';
import type { FeatureTabPatch } from '../feature-types.ts';
import { t, lang } from '../i18n.ts';
import { stripTerminalControl, terminalIdsFromContent } from './terminal.ts';
import { planEntries, upsertPlan, type PlanEntry, type PlanItem } from './plan.ts';
import { richContent, type RichContent } from './content.ts';
import { externalHttpUrl } from './external.ts';
import {
  prepareAttachment,
  promptContentForAttachment,
  type PromptAttachment,
  type PromptCapabilities,
} from './attachment.ts';
import { loadMcpServers, mcpStorageKey, parseKeyValueLines, parseLines, storeMcpServers } from './mcp.ts';
import { MAX_SYSTEM_PROMPT, loadSystemPrompt, storeSystemPrompt, systemPromptStorageKey } from './system-prompt.ts';
import {
  applyCompactionChunk,
  applyCompactionUpdate,
  noticeItem,
  type StatusItem,
} from './status.ts';
import { configChoices, modeStateFromOptions, secondaryConfigOptions } from './config.ts';
import { css } from './styles.ts';

export type FeatureTabSpec = {
  key: string;
  title: string;
  path: string;
  icon?: string;
};
export type FeatureTabsState = {
  tabs: readonly FeatureTabSpec[];
  activeKey?: string | null;
};
export type FeatureToolbarAction = {
  id: string;
  title: string;
  icon: string;
  disabled?: boolean;
  danger?: boolean;
  onClick(): void;
};
export type FeatureUiProps = {
  base: string;
  theme: string;
  lang: string;
  path: string;
  onTabs?(state: FeatureTabsState): void;
  onToolbar?(actions: FeatureToolbarAction[]): void;
  onOpenPath?(path: string, patch?: FeatureTabPatch): void;
  onClosePath?(path: string): void;
  onUpdateTab?(path: string, patch: FeatureTabPatch): void;
};
export type FeatureUiHandle = {
  dispose(): void;
  update?(patch: { theme?: string; lang?: string; path?: string }): void;
};

type ToolStatus = 'streaming' | 'running' | 'completed' | 'error';
type ToolFile = { uri: string; mime: string; name?: string | null };
type ToolItem = {
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
type Tokens = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
};
type Usage = { cost?: number; tokens?: Tokens };
type AssistantItem = {
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
  streaming: boolean;
};
type ChatItem =
  | { kind: 'user'; id: string; text: string; rich: RichContent[]; content: PromptContent[]; time: number }
  | AssistantItem
  | PlanItem
  | StatusItem;

let localID = 0;
const nextID = (prefix: string) => `${prefix}-${++localID}`;

function isFree(model: Model): boolean {
  const cost = model.cost?.[0];
  return !!cost && cost.input === 0 && cost.output === 0;
}

function modelKey(model: Model): string {
  return `${model.providerID}/${model.id}`;
}

function modelLabel(model: Model | null | undefined): string {
  if (!model) return t('agent.noModel');
  return model.name || model.id;
}

function providerLabel(providers: Provider[], id: string): string {
  return providers.find((provider) => provider.id === id)?.name ?? id;
}

function formatTokens(value?: number | null): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function formatCost(value?: number | null): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function formatRelative(timestamp?: number | null): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return t('agent.time.now');
  if (diff < 3_600_000) return t('agent.time.minutes', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('agent.time.hours', { n: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return t('agent.time.days', { n: Math.floor(diff / 86_400_000) });
  return new Date(timestamp).toLocaleDateString(lang() === 'zh' ? 'zh-CN' : undefined, { month: 'short', day: 'numeric' });
}

function formatDuration(start?: number, end?: number): string {
  if (!start) return '';
  const ms = Math.max(0, (end ?? Date.now()) - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatError(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
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

function acpContentText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (content.type === 'text') return String(content.text ?? '');
  return '';
}

function acpToolText(content: any): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'content') {
      const text = acpContentText(part.content);
      if (text) parts.push(text);
    } else if (part.type === 'diff') {
      parts.push(`--- ${part.path}\n+++ ${part.path}\n${part.oldText ?? ''}\n${part.newText ?? ''}`);
    } else if (part.type === 'terminal') {
      // Rendered from the live terminal output panel.
    }
  }
  return parts.join('\n');
}

function acpToolFiles(content: any, locations?: any): ToolFile[] {
  const files: ToolFile[] = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === 'file' && typeof part.uri === 'string') {
      files.push({ uri: part.uri, mime: String(part.mime ?? ''), name: part.name ?? null });
    }
  }
  for (const location of Array.isArray(locations) ? locations : []) {
    if (typeof location?.path === 'string' && !files.some((file) => file.uri === location.path)) {
      files.push({ uri: location.path, mime: '', name: location.path.split('/').pop() ?? location.path });
    }
  }
  return files;
}

function terminalExitLabel(status: TerminalExit): string {
  if (status.signal) return t('agent.terminalSignaled', { signal: status.signal });
  if (status.exitCode !== null) return t('agent.terminalExit', { code: status.exitCode });
  return t('agent.terminalExited');
}

function acpToolRich(content: any): RichContent[] {
  if (!Array.isArray(content)) return [];
  const rich: RichContent[] = [];
  for (const part of content) {
    if (part?.type === 'content') {
      const value = richContent(part.content);
      if (value) rich.push(value);
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
    id: String(update.toolCallId ?? update.id ?? nextID('tool')),
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

function normalizeHistory(updates: any[]): ChatItem[] {
  const out: ChatItem[] = [];
  const toolOwners = new Map<string, ToolItem>();
  let assistant: AssistantItem | null = null;
  let assistantID: string | null = null;
  let user: { kind: 'user'; id: string; text: string; rich: RichContent[]; content: PromptContent[]; time: number } | null = null;
  let userID: string | null = null;
  let updateIndex = 0;

  const ensureAssistant = (id?: string): AssistantItem => {
    if (!assistant || (id && assistantID && id !== assistantID)) {
      assistant = {
        kind: 'assistant',
        id: id || nextID('assistant'),
        text: '',
        reasoning: '',
        rich: [],
        tools: [],
        time: Date.now(),
        streaming: false,
      };
      assistantID = assistant.id;
      out.push(assistant);
    }
    return assistant;
  };

  for (const update of updates) {
    if (!update || typeof update !== 'object') continue;
    updateIndex += 1;
    switch (update.sessionUpdate) {
      case 'user_message_chunk': {
        const id = String(update.messageId ?? nextID('user'));
        const text = acpContentText(update.content);
        if (!user || (userID && id !== userID)) {
          user = { kind: 'user', id, text: '', rich: [], content: [], time: Date.now() };
          userID = id;
          out.push(user);
          assistant = null;
          assistantID = null;
        }
        user.text += text;
        const rich = richContent(update.content);
        if (rich) user.rich.push(rich);
        if (update.content && typeof update.content === 'object') {
          user.content.push(update.content as PromptContent);
        }
        break;
      }
      case 'agent_message_chunk': {
        user = null;
        userID = null;
        const text = acpContentText(update.content);
        const rich = richContent(update.content);
        if (!text && !rich) break;
        const item = ensureAssistant(String(update.messageId ?? '').replace(/:reasoning:\d+$/, '') || undefined);
        if (text) item.text += text;
        if (rich) item.rich.push(rich);
        break;
      }
      case 'agent_thought_chunk': {
        user = null;
        userID = null;
        const text = acpContentText(update.content);
        if (!text) break;
        const item = ensureAssistant(String(update.messageId ?? '').replace(/:reasoning:\d+$/, '') || undefined);
        item.reasoning += text;
        break;
      }
      case 'tool_call': {
        user = null;
        userID = null;
        const tool = acpTool(update);
        const existing = toolOwners.get(tool.id);
        if (existing) {
          Object.assign(existing, tool);
          break;
        }
        const item = ensureAssistant();
        item.tools.push(tool);
        toolOwners.set(tool.id, tool);
        break;
      }
      case 'tool_call_update': {
        const tool = toolOwners.get(String(update.toolCallId));
        if (tool) {
          if (update.status !== undefined) tool.status = acpToolStatus(update.status);
          if (update.title !== undefined) tool.name = String(update.title ?? tool.name);
          if (update.name !== undefined) tool.name = String(update.name ?? tool.name);
          if (update.content !== undefined) {
            tool.content = acpToolText(update.content);
            tool.rich = acpToolRich(update.content);
            tool.terminalIds = terminalIdsFromContent(update.content);
          }
          if (update.locations !== undefined) tool.files = acpToolFiles(update.content, update.locations);
          if (update.rawInput !== undefined) { tool.inputObject = update.rawInput; tool.input = stringify(update.rawInput); }
          if (update.rawOutput !== undefined) tool.metadata = update.rawOutput;
        }
        break;
      }
      case 'usage_update': {
        const item = ensureAssistant();
        item.usage = {
          cost: typeof update.cost?.amount === 'number' ? update.cost.amount : item.usage?.cost,
          tokens: {
            input: Number(update.used ?? 0),
            output: 0,
            reasoning: item.usage?.tokens?.reasoning,
          },
        };
        break;
      }
      case 'notice': {
        const item = noticeItem(update, Date.now(), `notice-${updateIndex}`);
        if (item) out.push(item);
        break;
      }
      case 'compaction_update': {
        out.splice(0, out.length, ...applyCompactionUpdate(out, update, Date.now(), nextID('compaction')));
        break;
      }
      case 'compaction_summary_chunk': {
        out.splice(0, out.length, ...applyCompactionChunk(out, update, Date.now(), nextID('compaction')));
        break;
      }
      case 'plan': {
        const entries = planEntries(update);
        if (!entries) break;
        const plan: PlanItem = { kind: 'plan', id: 'plan', entries, time: Date.now() };
        out.splice(0, out.length, ...upsertPlan(out, plan));
        assistant = null;
        assistantID = null;
        user = null;
        userID = null;
        break;
      }
      default:
        break;
    }
  }
  return out.filter((item) => item.kind !== 'assistant' || item.text || item.reasoning || item.rich.length || item.tools.length || item.usage || item.error);
}

function sessionTitle(session: Session | null): string {
  return session?.title?.trim() || t('agent.newChat');
}

function sessionPathID(path: string): string | null {
  const segment = path.replace(/^\/+/, '').split('/')[0];
  if (!segment) return null;
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function chooseDefaultModel(models: Model[], status: Status | null): Model | null {
  if (status?.defaultModel) {
    const exact = models.find((model) =>
      model.providerID === status.defaultModel!.providerID && model.id === status.defaultModel!.id);
    if (exact) return exact;
  }
  const normal = models.filter((model) => !isFree(model));
  return normal[0] ?? models[0] ?? null;
}

function modelFromConfig(options: Session['configOptions'], models: Model[]): Model | null {
  const option = options?.find((entry) => entry.id === 'model' || entry.category === 'model');
  if (!option || typeof option.currentValue !== 'string') return null;
  const [providerID, ...rest] = option.currentValue.split('/');
  return models.find((model) => model.providerID === providerID && model.id === rest.join('/')) ?? null;
}

function toolLabel(name: string): string {
  const keys: Record<string, string> = {
    bash: 'agent.tool.terminal',
    shell: 'agent.tool.terminal',
    read: 'agent.tool.read',
    write: 'agent.tool.write',
    edit: 'agent.tool.edit',
    patch: 'agent.tool.patch',
    glob: 'agent.tool.glob',
    grep: 'agent.tool.grep',
    webfetch: 'agent.tool.fetch',
    websearch: 'agent.tool.websearch',
    task: 'agent.tool.subagent',
    todowrite: 'agent.tool.todosWrite',
    todoread: 'agent.tool.todosRead',
    question: 'agent.tool.question',
    skill: 'agent.tool.skill',
  };
  const key = keys[name.toLowerCase()];
  return key ? t(key) : name;
}

function toolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const value = input as Record<string, any>;
  if (name === 'bash' || name === 'shell') return String(value.command ?? value.cmd ?? '');
  if (value.filePath) return String(value.filePath);
  if (value.path) return String(value.path);
  if (value.file) return String(value.file);
  if (value.pattern) return String(value.pattern);
  if (value.url) return String(value.url);
  if (value.description) return String(value.description);
  if (value.query) return String(value.query);
  return '';
}

function isDiff(text: string): boolean {
  if (!text) return false;
  const lines = text.split('\n');
  const hasHeader = lines.some((line) => line.startsWith('diff --git') || line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---'));
  const hasChanges = lines.some((line) => line.startsWith('+') || line.startsWith('-'));
  return hasHeader && hasChanges;
}

function parseCommand(text: string, commands: Command[]): { name: string; args: string } | null {
  const match = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  if (!commands.some((command) => command.name === match[1])) return null;
  return { name: match[1], args: (match[2] ?? '').trim() };
}

function IconButton(props: {
  icon: IconName;
  title: string;
  onClick?: (event: MouseEvent) => void;
  disabled?: boolean;
  class?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      class={`op-icon-btn ${props.class ?? ''}`}
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={(event) => props.onClick?.(event)}
    >
      <Icon name={props.icon} size={props.size ?? 16} />
    </button>
  );
}

function Spinner(props: { size?: number }) {
  return <span class="op-spinner" style={{ width: `${props.size ?? 14}px`, height: `${props.size ?? 14}px` }} />;
}

function MarkdownText(props: { text: string; class?: string }) {
  let element!: HTMLDivElement;
  createEffect(() => {
    const value = props.text;
    element.innerHTML = renderMarkdown(value);
    enhanceMarkdown(element);
  });
  return <div ref={element} class={`op-markdown ${props.class ?? ''}`} />;
}

function ModelPicker(props: {
  models: Model[];
  providers: Provider[];
  value: Model | null;
  onSelect: (model: Model) => void;
  buttonClass?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let root!: HTMLDivElement;
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const list = props.models.filter((model) =>
      !q
      || modelLabel(model).toLowerCase().includes(q)
      || model.id.toLowerCase().includes(q)
      || model.providerID.toLowerCase().includes(q)
      || providerLabel(props.providers, model.providerID).toLowerCase().includes(q));
    const groups = new Map<string, Model[]>();
    for (const model of list) {
      const items = groups.get(model.providerID) ?? [];
      items.push(model);
      groups.set(model.providerID, items);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => providerLabel(props.providers, a).localeCompare(providerLabel(props.providers, b)))
      .map(([providerID, items]) => ({
        providerID,
        label: providerLabel(props.providers, providerID),
        items: items.sort((a, b) => modelLabel(a).localeCompare(modelLabel(b))),
      }));
  });

  onMount(() => {
    const onDown = (event: MouseEvent) => {
      if (open() && root && !event.composedPath().includes(root)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    onCleanup(() => document.removeEventListener('mousedown', onDown));
  });

  return (
    <div class={`op-model-picker ${props.buttonClass ?? ''}`} ref={root}>
      <button type="button" class="op-model-button" onClick={() => setOpen((value) => !value)} title={t('agent.selectModel')}>
        <Icon name="sparkles" size={14} />
        <span class="op-ellipsis">{modelLabel(props.value)}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      <Show when={open()}>
        <div class="op-popover op-model-popover">
          <div class="op-popover-head">
            <Icon name="search" size={15} />
            <input
              value={query()}
              placeholder={t('agent.searchModels')}
              autofocus
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
            />
          </div>
          <div class="op-popover-list">
            <Show when={filtered().length > 0} fallback={<div class="op-popover-empty">{t('agent.noModels')}</div>}>
              <For each={filtered()}>
                {(group) => (
                  <div class="op-model-group">
                    <div class="op-model-group-label">{group.label}</div>
                    <For each={group.items}>
                      {(model) => (
                        <button
                          type="button"
                          class={`op-model-option ${props.value && modelKey(model) === modelKey(props.value) ? 'active' : ''}`}
                          onClick={() => { props.onSelect(model); setOpen(false); }}
                          title={`${model.providerID}/${model.id}`}
                        >
                          <span class="op-model-option-main">
                            <span>{modelLabel(model)}</span>
                            <span class="op-model-option-id">{model.id}</span>
                          </span>
                          <Show when={props.value && modelKey(model) === modelKey(props.value)}>
                            <Icon name="check" size={15} />
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

function ModeSelect(props: {
  modes: AgentModeState | null;
  disabled?: boolean;
  onChange: (modeID: string) => void;
}) {
  return (
    <Show when={props.modes && props.modes.availableModes.length > 1 ? props.modes : null}>
      {(modes) => (
        <label class="op-agent" title={t('agent.mode')}>
          <Icon name="shield" size={14} />
          <select
            value={modes().currentModeId}
            disabled={props.disabled}
            aria-label={t('agent.mode')}
            onChange={(event) => props.onChange(event.currentTarget.value)}
          >
            <For each={modes().availableModes}>
              {(mode) => <option value={mode.id} title={mode.description}>{modeLabel(mode)}</option>}
            </For>
          </select>
          <Icon name="chevron-down" size={13} />
        </label>
      )}
    </Show>
  );
}

function ConfigMenu(props: {
  options: ConfigOption[];
  disabled?: boolean;
  busy?: boolean;
  onSelect: (configID: string, value: string | boolean) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const visible = createMemo(() => secondaryConfigOptions(props.options));

  onMount(() => {
    const onDown = (event: MouseEvent) => {
      if (open() && root && !event.composedPath().includes(root)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    });
  });

  return (
    <div class="op-config-picker" ref={root}>
      <Show when={visible().length > 0}>
        <button
          type="button"
          class="op-model-button op-config-button"
          disabled={props.disabled}
          onClick={() => setOpen((value) => !value)}
          title={t('agent.sessionSettings')}
        >
          <Icon name="sliders" size={14} />
          <span class="op-ellipsis">{t('agent.sessionSettings')}</span>
          <Show when={props.busy}><Spinner size={11} /></Show>
          <Icon name="chevron-down" size={14} />
        </button>
      </Show>
      <Show when={open() && visible().length > 0}>
        <div class="op-popover op-config-popover">
          <div class="op-config-head">
            <Icon name="sliders" size={15} />
            <span>{t('agent.sessionSettings')}</span>
          </div>
          <div class="op-config-list">
            <For each={visible()}>
              {(option) => (
                <div class="op-config-row">
                  <div class="op-config-copy">
                    <span class="op-config-name">{option.name}</span>
                    <Show when={option.description}>
                      <span class="op-config-desc">{option.description}</span>
                    </Show>
                  </div>
                  <Show
                    when={option.type === 'boolean'}
                    fallback={
                      <select
                        class="op-config-select"
                        value={String(option.currentValue)}
                        disabled={props.disabled || props.busy}
                        onChange={(event) => props.onSelect(option.id, event.currentTarget.value)}
                      >
                        <For each={configChoices(option)}>
                          {(choice) => <option value={choice.value} title={choice.description ?? undefined}>{choice.name}</option>}
                        </For>
                      </select>
                    }
                  >
                    <input
                      class="op-config-check"
                      type="checkbox"
                      checked={option.currentValue === true}
                      disabled={props.disabled || props.busy}
                      onChange={(event) => props.onSelect(option.id, event.currentTarget.checked)}
                    />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

function modeLabel(mode: { id: string; name: string }): string {
  const key = `agent.mode.${mode.id}`;
  const translated = t(key);
  return translated === key ? mode.name : translated;
}

function RuntimeAgentPicker(props: {
  agents: DiscoveredAgent[];
  value: string | null;
  disabled?: boolean;
  onChange: (id: string) => void;
  class?: string;
}) {
  if (props.agents.length <= 1) return null;
  const current = () => props.value && props.agents.some((agent) => agent.id === props.value)
    ? props.value
    : props.agents[0]?.id ?? '';
  return (
    <label class={`op-runtime-agent ${props.class ?? ''}`} title={t('agent.acpAgent')}>
      <Icon name="brain" size={14} />
      <select
        value={current()}
        disabled={props.disabled}
        aria-label={t('agent.acpAgent')}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        <For each={props.agents}>
          {(agent) => <option value={agent.id}>{agent.name}</option>}
        </For>
      </select>
      <Icon name="chevron-down" size={13} />
    </label>
  );
}

function CommandMenu(props: {
  commands: Command[];
  query: string;
  onPick: (command: Command) => void;
  onClose: () => void;
}) {
  const filtered = createMemo(() => {
    const q = props.query.trim().toLowerCase();
    return props.commands.filter((command) =>
      !q || command.name.toLowerCase().includes(q) || (command.description ?? '').toLowerCase().includes(q));
  });
  return (
    <div class="op-command-menu">
      <div class="op-command-head">
        <span>{t('agent.commands')}</span>
        <button type="button" class="op-icon-btn" onClick={props.onClose} title={t('agent.close')}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div class="op-command-list">
        <Show when={filtered().length > 0} fallback={<div class="op-popover-empty">{t('agent.noCommands')}</div>}>
          <For each={filtered()}>
            {(command) => (
              <button type="button" class="op-command-option" onClick={() => props.onPick(command)}>
                <span class="op-command-name">/{command.name}</span>
                <Show when={command.description}>
                  <span class="op-command-desc">{command.description}</span>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function Composer(props: {
  draft: string;
  busy: boolean;
  agentName: string;
  models: Model[];
  providers: Provider[];
  model: Model | null;
  modes: AgentModeState | null;
  configOptions: ConfigOption[];
  configBusy: boolean;
  attachments: PromptAttachment[];
  attachmentBusy: boolean;
  commands: Command[];
  disabled: boolean;
  onDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onModel: (model: Model) => void;
  onMode: (modeID: string) => void;
  onConfig: (configID: string, value: string | boolean) => void;
  onAttach: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onCommand: (command: Command) => void;
  onResume: () => void;
}) {
  let textarea!: HTMLTextAreaElement;
  let fileInput!: HTMLInputElement;
  const [commandOpen, setCommandOpen] = createSignal(false);
  const commands = createMemo(() => [
    { name: 'resume', description: t('agent.resumeCommand') },
    ...props.commands.filter((command) => command.name !== 'resume'),
  ]);
  const slashQuery = createMemo(() => {
    const value = props.draft;
    if (!value.startsWith('/') || value.includes(' ')) return null;
    return value.slice(1);
  });
  const commandQuery = createMemo(() => slashQuery() ?? '');
  const showCommands = createMemo(() => commandOpen() || slashQuery() !== null);

  function resize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(220, textarea.scrollHeight)}px`;
  }

  createEffect(() => {
    props.draft;
    resize();
  });

  function submit() {
    if (props.busy || props.disabled || props.attachmentBusy) return;
    if (props.draft.trim() === '/resume') {
      props.onDraft('');
      props.onResume();
      setCommandOpen(false);
      return;
    }
    props.onSend();
    setCommandOpen(false);
  }

  function pickCommand(command: Command) {
    if (command.name === 'resume') {
      props.onDraft('');
      props.onResume();
      setCommandOpen(false);
      return;
    }
    props.onCommand(command);
    setCommandOpen(false);
    textarea?.focus();
    resize();
  }

  return (
    <div class="op-composer">
      <Show when={showCommands()}>
        <CommandMenu
          commands={commands()}
          query={commandQuery()}
          onPick={pickCommand}
          onClose={() => setCommandOpen(false)}
        />
      </Show>
      <div class="op-composer-box">
        <input
          ref={fileInput}
          class="op-file-input"
          type="file"
          multiple
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files?.length) props.onAttach(files);
            event.currentTarget.value = '';
          }}
        />
        <Show when={props.attachments.length > 0}>
          <div class="op-attachments">
            <For each={props.attachments}>
              {(attachment) => (
                <div class="op-attachment" title={attachment.name}>
                  <Show
                    when={attachment.kind === 'image' && attachment.data}
                    fallback={<span class="op-attachment-icon"><Icon name="file" size={13} /></span>}
                  >
                    <img
                      class="op-attachment-thumb"
                      src={`data:${attachment.mimeType};base64,${attachment.data}`}
                      alt={attachment.name}
                    />
                  </Show>
                  <span class="op-attachment-name">{attachment.name}</span>
                  <button
                    type="button"
                    class="op-attachment-remove"
                    title={t('agent.removeAttachment')}
                    aria-label={t('agent.removeAttachment')}
                    onClick={() => props.onRemoveAttachment(attachment.id)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
        <textarea
          ref={textarea}
          class="op-textarea"
          value={props.draft}
          rows={1}
          placeholder={t('agent.composer.placeholder', { agent: props.agentName })}
          disabled={props.disabled}
          onInput={(event) => {
            props.onDraft(event.currentTarget.value);
            resize();
          }}
          onPaste={(event) => {
            const files = event.clipboardData?.files;
            if (files?.length) {
              event.preventDefault();
              props.onAttach(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              submit();
            }
            if (event.key === 'Escape') setCommandOpen(false);
          }}
        />
        <div class="op-composer-bar">
          <div class="op-composer-tools">
            <button
              type="button"
              class="op-icon-btn"
              title={t('agent.attach')}
              aria-label={t('agent.attach')}
              disabled={props.disabled || props.attachmentBusy}
              onClick={() => fileInput.click()}
            >
              <Show when={props.attachmentBusy} fallback={<Icon name="paperclip" size={15} />}>
                <Spinner size={12} />
              </Show>
            </button>
            <ModelPicker
              models={props.models}
              providers={props.providers}
              value={props.model}
              onSelect={props.onModel}
              buttonClass="op-composer-model"
            />
            <ModeSelect modes={props.modes} onChange={props.onMode} disabled={props.busy || props.disabled} />
            <ConfigMenu
              options={props.configOptions}
              disabled={props.disabled}
              busy={props.configBusy}
              onSelect={props.onConfig}
            />
            <IconButton
              icon="list"
              title={t('agent.commands')}
              class={showCommands() ? 'active' : ''}
              onClick={() => setCommandOpen((value) => !value)}
            />
          </div>
          <div class="op-composer-actions">
            <Show when={props.busy} fallback={
              <button
                type="button"
                class="op-send"
                disabled={props.disabled || props.attachmentBusy || (!props.draft.trim() && props.attachments.length === 0)}
                onClick={submit}
                title={t('agent.send')}
              >
                <Icon name="send" size={17} />
              </button>
            }>
              <button
                type="button"
                class="op-send op-send-stop"
                onClick={props.onStop}
                title={t('agent.stop')}
                aria-label={t('agent.stop')}
              >
                <span class="op-stop-square" />
              </button>
            </Show>
          </div>
        </div>
      </div>
      <div class="op-composer-hint">
        <span>{t('agent.composer.sendHint')}</span>
        <span>{t('agent.composer.commandHint')}</span>
      </div>
    </div>
  );
}

function DiffBlock(props: { text: string }) {
  return (
    <pre class="op-diff">
      <For each={props.text.split('\n')}>
        {(line) => {
          const tone = line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('@@')
            ? 'meta'
            : line.startsWith('+')
              ? 'add'
              : line.startsWith('-')
                ? 'del'
                : '';
          return <span class={`op-diff-line ${tone}`}>{line || ' '}</span>;
        }}
      </For>
    </pre>
  );
}

function ToolCard(props: { tool: ToolItem; onCopy: (text: string) => void; terminalOutputs?: Record<string, TerminalOutput> }) {
  const summary = createMemo(() => toolSummary(props.tool.name, props.tool.inputObject));
  const duration = createMemo(() => props.tool.time ? formatDuration(props.tool.time.ran ?? props.tool.time.created, props.tool.time.completed) : '');
  const open = createMemo(() => props.tool.status === 'error' || props.tool.terminalIds.length > 0);
  return (
    <details class={`op-tool ${props.tool.status}`} open={open()}>
      <summary class="op-tool-head">
        <span class="op-tool-status">
          <Show when={props.tool.status === 'streaming' || props.tool.status === 'running'} fallback={
            <Icon name={props.tool.status === 'error' ? 'x' : 'check'} size={14} />
          }>
            <Spinner size={12} />
          </Show>
        </span>
        <span class="op-tool-name">{toolLabel(props.tool.name)}</span>
        <Show when={summary()}>
          <span class="op-tool-summary" title={summary()}>{summary()}</span>
        </Show>
        <span class="op-tool-spacer" />
        <Show when={duration()}>
          <span class="op-tool-duration">{duration()}</span>
        </Show>
        <Icon name="chevron-right" size={14} class="op-tool-chevron" />
      </summary>
      <div class="op-tool-body">
        <Show when={props.tool.input}>
          <div class="op-tool-section">
            <div class="op-tool-section-head">
              <span>{t('agent.tool.input')}</span>
              <IconButton icon="copy" title={t('agent.copyInput')} onClick={() => props.onCopy(props.tool.input)} />
            </div>
            <pre class="op-tool-input">{props.tool.input}</pre>
          </div>
        </Show>
        <Show when={props.tool.content}>
          <div class="op-tool-section">
            <div class="op-tool-section-head">
              <span>{t('agent.tool.output')}</span>
              <IconButton icon="copy" title={t('agent.copyOutput')} onClick={() => props.onCopy(props.tool.content)} />
            </div>
            <Show when={isDiff(props.tool.content)} fallback={<pre class="op-tool-output">{props.tool.content}</pre>}>
              <DiffBlock text={props.tool.content} />
            </Show>
          </div>
        </Show>
        <RichContentList items={props.tool.rich} />
        <Show when={props.tool.terminalIds.length > 0}>
          <div class="op-tool-terminals">
            <For each={props.tool.terminalIds}>
              {(id) => {
                const snapshot = () => props.terminalOutputs?.[id];
                return (
                  <div class="op-tool-terminal">
                    <div class="op-tool-terminal-head">
                      <Icon name="terminal" size={12} />
                      <span>{t('agent.terminalOutput')}</span>
                      <span class="op-tool-spacer" />
                      <Show when={snapshot()?.truncated}>
                        <span class="op-tool-terminal-hint">{t('agent.terminalTruncated')}</span>
                      </Show>
                      <Show when={snapshot()?.exitStatus}>
                        {(exit) => <span class="op-tool-terminal-hint">{terminalExitLabel(exit())}</span>}
                      </Show>
                    </div>
                    <pre class="op-tool-terminal-output">
                      {snapshot() ? stripTerminalControl(snapshot()!.output) : t('agent.terminalWaiting')}
                    </pre>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
        <Show when={props.tool.files.length > 0}>
          <div class="op-tool-files">
            <For each={props.tool.files}>
              {(file) => (
                <span class="op-file-chip" title={file.uri}>
                  <Icon name="file" size={12} />
                  {file.name || file.uri.split('/').pop() || file.uri}
                </span>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.tool.error}>
          <div class="op-tool-error">{props.tool.error}</div>
        </Show>
      </div>
    </details>
  );
}

function PermissionCard(props: {
  request: PermissionRequest;
  onReply: (optionID: string) => void;
}) {
  return (
    <div class="op-permission">
      <div class="op-permission-head">
        <span class="op-permission-icon"><Icon name="shield" size={16} /></span>
        <div>
          <div class="op-permission-title">{t('agent.permissionRequired')}</div>
          <div class="op-permission-action">{props.request.title}</div>
        </div>
      </div>
      <Show when={props.request.message}>
        <div class="op-permission-message">{props.request.message}</div>
      </Show>
      <Show
        when={props.request.options.length > 0}
        fallback={<div class="op-permission-message">{t('agent.noPermissionOptions')}</div>}
      >
        <div class="op-permission-actions">
          <For each={props.request.options}>
            {(option) => {
              const reject = option.kind.startsWith('reject');
              const primary = option.kind.startsWith('allow');
              return (
                <button
                  type="button"
                  class={`op-btn ${reject ? 'danger' : primary ? 'primary' : ''}`}
                  onClick={() => props.onReply(option.optionId)}
                >
                  {option.name}
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

function FormCard(props: {
  form: FormInfo;
  onReply: (answer: Record<string, unknown>) => void;
  onDecline: () => void;
  onCancel: () => void;
}) {
  const defaults = Object.fromEntries(
    props.form.fields
      .filter((field) => field.default !== undefined)
      .map((field) => [field.key, field.default]),
  );
  const [values, setValues] = createSignal<Record<string, unknown>>(defaults);
  const [error, setError] = createSignal<string | null>(null);
  const visible = (field: FormField): boolean => {
    if (field.hidden) return false;
    if (!field.when || field.when.length === 0) return true;
    return field.when.every((condition) => {
      const value = values()[condition.key];
      return condition.op === 'eq' ? value === condition.value : value !== condition.value;
    });
  };
  const setValue = (key: string, value: unknown) => {
    setError(null);
    setValues((prev) => ({ ...prev, [key]: value }));
  };
  const missing = (field: FormField): boolean => {
    const value = values()[field.key];
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  };
  const submit = () => {
    const required = props.form.fields.filter((field) => visible(field) && field.required && missing(field));
    if (required.length > 0) {
      setError(t('agent.requiredFields', { fields: required.map((field) => field.title || field.key).join(', ') }));
      return;
    }
    props.onReply(values());
  };
  if (props.form.mode === 'url') {
    const target = () => externalHttpUrl(props.form.url);
    const open = () => {
      const url = target();
      if (!url) return;
      // Use a real anchor so the browser applies noopener/noreferrer from the
      // click itself; window.open cannot reliably report blocked popups while
      // also severing the opener before navigation.
      const anchor = document.createElement('a');
      anchor.href = url.toString();
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      props.onReply({});
    };
    return (
      <div class="op-form op-url-form">
        <div class="op-form-head">
          <span class="op-form-icon"><Icon name="shield" size={16} /></span>
          <div>
            <div class="op-form-title">{props.form.title || t('agent.urlElicitation')}</div>
            <div class="op-form-subtitle">
              {props.form.message && props.form.message !== props.form.title
                ? props.form.message
                : t('agent.urlElicitationHint')}
            </div>
          </div>
        </div>
        <div class="op-url-target">
          <span class="op-url-host">{target()?.host ?? props.form.url ?? ''}</span>
          <code class="op-url-full">{target()?.toString() ?? props.form.url ?? ''}</code>
        </div>
        <div class="op-url-warning">
          <Icon name="alert" size={13} />
          <span>{t('agent.urlWarning')}</span>
        </div>
        <Show when={!target()}>
          <div class="op-form-error">{t('agent.invalidUrl')}</div>
        </Show>
        <Show when={error()}>
          <div class="op-form-error">{error()}</div>
        </Show>
        <div class="op-form-actions">
          <button type="button" class="op-btn primary" disabled={!target()} onClick={open}>
            {t('agent.openLink')}
          </button>
          <button type="button" class="op-btn" onClick={props.onDecline}>{t('agent.decline')}</button>
          <button type="button" class="op-btn" onClick={props.onCancel}>{t('agent.cancel')}</button>
        </div>
      </div>
    );
  }
  return (
    <div class="op-form">
      <div class="op-form-head">
        <span class="op-form-icon"><Icon name="info" size={16} /></span>
        <div>
          <div class="op-form-title">{props.form.title}</div>
          <div class="op-form-subtitle">
            {props.form.message && props.form.message !== props.form.title
              ? props.form.message
              : t('agent.inputNeeded')}
          </div>
        </div>
      </div>
      <For each={props.form.fields}>
        {(field) => (
          <Show when={visible(field)}>
            <label class="op-field">
              <span class="op-field-label">
                {field.title || field.key}
                <Show when={field.required}><span class="op-required">*</span></Show>
              </span>
              <Show when={field.description}><span class="op-field-desc">{field.description}</span></Show>
              <Show when={field.type === 'external'}>
                <a class="op-external" href={field.url ?? '#'} target="_blank" rel="noopener noreferrer">
                  {t('agent.openExternal')}
                </a>
              </Show>
              <Show when={field.type === 'boolean'}>
                <label class="op-check">
                  <input
                    type="checkbox"
                    checked={!!values()[field.key]}
                    onChange={(event) => setValue(field.key, event.currentTarget.checked)}
                  />
                  <span>{field.placeholder || t('agent.yes')}</span>
                </label>
              </Show>
              <Show when={field.type === 'multiselect'}>
                <div class="op-multiselect">
                  <For each={field.options ?? []}>
                    {(option) => (
                      <label class="op-check">
                        <input
                          type="checkbox"
                          checked={Array.isArray(values()[field.key]) && (values()[field.key] as string[]).includes(option.value)}
                          onChange={(event) => {
                            const current = Array.isArray(values()[field.key]) ? [...(values()[field.key] as string[])] : [];
                            setValue(field.key, event.currentTarget.checked
                              ? [...current, option.value]
                              : current.filter((value) => value !== option.value));
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={field.type === 'string' && (field.options?.length ?? 0) > 0}>
                <select
                  class="op-input"
                  value={String(values()[field.key] ?? field.default ?? '')}
                  onChange={(event) => setValue(field.key, event.currentTarget.value)}
                >
                  <option value="">{t('agent.select')}</option>
                  <For each={field.options ?? []}>
                    {(option) => <option value={option.value}>{option.label}</option>}
                  </For>
                </select>
              </Show>
              <Show when={
                field.type !== 'external'
                && field.type !== 'boolean'
                && field.type !== 'multiselect'
                && !(field.type === 'string' && (field.options?.length ?? 0) > 0)
              }>
                <input
                  class="op-input"
                  type={field.type === 'number' || field.type === 'integer'
                    ? 'number'
                    : field.format === 'email' ? 'email' : field.format === 'uri' ? 'url' : field.format === 'date' ? 'date' : field.format === 'date-time' ? 'datetime-local' : 'text'}
                  min={typeof field.minimum === 'number' ? field.minimum : undefined}
                  max={typeof field.maximum === 'number' ? field.maximum : undefined}
                  minLength={field.minLength}
                  maxLength={field.maxLength}
                  placeholder={field.placeholder}
                  value={String(values()[field.key] ?? field.default ?? '')}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setValue(field.key, field.type === 'number' || field.type === 'integer'
                      ? (value === '' ? undefined : Number(value))
                      : value);
                  }}
                />
              </Show>
            </label>
          </Show>
        )}
      </For>
      <Show when={error()}>
        <div class="op-form-error">{error()}</div>
      </Show>
      <div class="op-form-actions">
        <button type="button" class="op-btn primary" onClick={submit}>{t('agent.submit')}</button>
        <button type="button" class="op-btn" onClick={props.onCancel}>{t('agent.cancel')}</button>
      </div>
    </div>
  );
}

function richFileName(uri: string): string {
  try {
    const path = decodeURIComponent(new URL(uri).pathname);
    return path.split('/').filter(Boolean).pop() || uri;
  } catch {
    return uri.split('/').filter(Boolean).pop() || uri;
  }
}

function RichContentView(props: { item: RichContent }) {
  const item = props.item;
  if (item.type === 'image') {
    return (
      <img
        class="op-rich-image"
        src={`data:${item.mimeType};base64,${item.data}`}
        alt={t('agent.richImage')}
        loading="lazy"
      />
    );
  }
  if (item.type === 'audio') {
    return (
      <audio
        class="op-rich-audio"
        controls
        preload="metadata"
        src={`data:${item.mimeType};base64,${item.data}`}
      />
    );
  }
  if (item.type === 'resource_link') {
    return (
      <div class="op-rich-file" title={item.uri}>
        <Icon name="file" size={14} />
        <div class="op-rich-file-main">
          <span class="op-rich-file-name">{item.title || item.name}</span>
          <span class="op-rich-file-uri">{item.uri}</span>
        </div>
        <Show when={typeof item.size === 'number'}>
          <span class="op-rich-file-size">{item.size} B</span>
        </Show>
      </div>
    );
  }
  const name = richFileName(item.uri);
  if (item.text !== undefined) {
    return (
      <details class="op-rich-resource">
        <summary>
          <Icon name="file" size={13} />
          <span>{name}</span>
          <span class="op-rich-file-uri">{item.uri}</span>
        </summary>
        <pre class="op-rich-text">{item.text}</pre>
      </details>
    );
  }
  if (item.blob && item.mimeType?.startsWith('image/')) {
    return (
      <img
        class="op-rich-image"
        src={`data:${item.mimeType};base64,${item.blob}`}
        alt={t('agent.richImage')}
        loading="lazy"
      />
    );
  }
  if (item.blob && item.mimeType?.startsWith('audio/')) {
    return (
      <audio
        class="op-rich-audio"
        controls
        preload="metadata"
        src={`data:${item.mimeType};base64,${item.blob}`}
      />
    );
  }
  return (
    <div class="op-rich-file" title={item.uri}>
      <Icon name="file" size={14} />
      <div class="op-rich-file-main">
        <span class="op-rich-file-name">{t('agent.richBlob')}</span>
        <span class="op-rich-file-uri">{item.uri}</span>
      </div>
    </div>
  );
}

function RichContentList(props: { items?: RichContent[] }) {
  return (
    <Show when={props.items && props.items.length > 0}>
      <div class="op-rich-list">
        <For each={props.items}>
          {(item) => <RichContentView item={item} />}
        </For>
      </div>
    </Show>
  );
}

function PlanStatusIcon(props: { status: PlanEntry['status'] }) {
  if (props.status === 'completed') return <Icon name="check" size={12} />;
  if (props.status === 'in_progress') return <Spinner size={11} />;
  return <span class="op-plan-dot" />;
}

function PlanCard(props: { entries: PlanEntry[] }) {
  const done = createMemo(() => props.entries.filter((entry) => entry.status === 'completed').length);
  return (
    <div class="op-plan">
      <div class="op-plan-head">
        <Icon name="list" size={14} />
        <span>{t('agent.plan')}</span>
        <span class="op-plan-progress">
          {t('agent.planProgress', { done: done(), total: props.entries.length })}
        </span>
      </div>
      <div class="op-plan-list">
        <For each={props.entries}>
          {(entry) => (
            <div class={`op-plan-row ${entry.status}`}>
              <span class="op-plan-status"><PlanStatusIcon status={entry.status} /></span>
              <span class="op-plan-content">{entry.content}</span>
              <span
                class={`op-plan-priority ${entry.priority}`}
                title={t(`agent.planPriority.${entry.priority}`)}
              />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function MessageItem(props: {
  item: ChatItem;
  agentName: string;
  terminalOutputs?: Record<string, TerminalOutput>;
  onCopy: (text: string) => void;
  onRetry: () => void;
  onPermission: (request: PermissionRequest, optionID: string) => void;
  onForm: (form: FormInfo, answer: Record<string, unknown>) => void;
  onCancelForm: (form: FormInfo) => void;
}) {
  if (props.item.kind === 'user') {
    const user = props.item;
    return (
      <div class="op-message op-user">
        <div class="op-user-bubble">
          {user.text}
          <RichContentList items={user.rich} />
        </div>
        <div class="op-message-foot">
          <span>{formatRelative(user.time)}</span>
          <IconButton icon="copy" title={t('agent.copyMessage')} onClick={() => props.onCopy(user.text)} />
        </div>
      </div>
    );
  }
  if (props.item.kind === 'system') {
    const system = () => props.item as StatusItem;
    const block = () => Boolean(system().detail || system().rich?.length);
    const label = () => {
      const item = system();
      return item.textKey ? t(item.textKey, item.textParams) : item.text;
    };
    return (
      <div class={`op-system ${system().tone}${block() ? ' block' : ''}`}>
        <Icon
          name={system().tone === 'error' || system().tone === 'warning'
            ? 'alert'
            : system().tone === 'compaction'
              ? 'refresh'
              : 'info'}
          size={13}
        />
        <Show
          when={block()}
          fallback={<span>{label()}</span>}
        >
          <div class="op-system-body">
            <span class="op-system-title">{label()}</span>
            <Show when={system().detail}><span class="op-system-detail">{system().detail}</span></Show>
            <Show when={system().rich?.length}><RichContentList items={system().rich!} /></Show>
          </div>
        </Show>
      </div>
    );
  }
  if (props.item.kind === 'plan') {
    return <PlanCard entries={props.item.entries} />;
  }
  const item = () => props.item as AssistantItem;
  return (
    <div class="op-message op-assistant">
      <div class="op-message-head">
        <span class="op-avatar"><Icon name="sparkles" size={15} /></span>
        <span class="op-assistant-name">{props.agentName}</span>
        <Show when={item().model}><span class="op-assistant-model">{item().model}</span></Show>
        <Show when={item().streaming}><Spinner size={12} /></Show>
        <span class="op-message-spacer" />
        <Show when={item().usage && ((item().usage!.cost ?? 0) > 0 || item().usage!.tokens)}>
          <span class="op-usage">
            <Show when={(item().usage!.cost ?? 0) > 0}>{formatCost(item().usage!.cost)}</Show>
            <Show when={item().usage!.tokens}>
              {t('agent.usage.tokens', { n: formatTokens((item().usage!.tokens?.input ?? 0) + (item().usage!.tokens?.output ?? 0)) })}
            </Show>
          </span>
        </Show>
        <IconButton icon="copy" title={t('agent.copyResponse')} onClick={() => props.onCopy(item().text)} />
      </div>
      <Show when={item().reasoning}>
        <details class="op-reasoning" open={item().streaming}>
          <summary>
            <Icon name="brain" size={14} />
            <span>{t('agent.reasoning')}</span>
            <Icon name="chevron-right" size={13} class="op-reasoning-chevron" />
          </summary>
          <div class="op-reasoning-body">{item().reasoning}</div>
        </details>
      </Show>
      <Show when={item().text}>
        <MarkdownText text={item().text} />
      </Show>
      <RichContentList items={item().rich} />
      <Show when={item().tools.length > 0}>
        <div class="op-tools">
          <Index each={item().tools}>
            {(tool) => <ToolCard tool={tool()} onCopy={props.onCopy} terminalOutputs={props.terminalOutputs} />}
          </Index>
        </div>
      </Show>
      <Show when={item().error}>
        <div class="op-message-error">
          <Icon name="alert" size={15} />
          <div>
            <div>{item().error}</div>
            <button type="button" class="op-link-btn" onClick={props.onRetry}>{t('agent.sendAgain')}</button>
          </div>
        </div>
      </Show>
      <Show when={!item().streaming && !item().text && !item().reasoning && item().rich.length === 0 && item().tools.length === 0 && !item().error}>
        <div class="op-message-empty">{t('agent.noResponse')}</div>
      </Show>
    </div>
  );
}

function MessageList(props: {
  items: ChatItem[];
  busy: boolean;
  agentName: string;
  terminalOutputs?: Record<string, TerminalOutput>;
  onSuggestion: (text: string) => void;
  onCopy: (text: string) => void;
  onRetry: () => void;
  onPermission: (request: PermissionRequest, optionID: string) => void;
  onForm: (form: FormInfo, answer: Record<string, unknown>) => void;
  onCancelForm: (form: FormInfo) => void;
}) {
  let scroller!: HTMLDivElement;
  const [atBottom, setAtBottom] = createSignal(true);
  const [showJump, setShowJump] = createSignal(false);

  function scrollToBottom() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    setAtBottom(true);
    setShowJump(false);
  }

  function onScroll() {
    if (!scroller) return;
    const bottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    setAtBottom(bottom);
    setShowJump(!bottom);
  }

  createEffect(() => {
    props.items;
    if (atBottom()) queueMicrotask(scrollToBottom);
  });

  return (
    <div class="op-message-wrap">
      <div class="op-messages" ref={scroller} onScroll={onScroll}>
        <Show
          when={props.items.length > 0}
          fallback={
            <div class="op-empty">
              <div class="op-empty-mark"><Icon name="sparkles" size={30} /></div>
              <h2>{t('agent.empty.title')}</h2>
              <p>{t('agent.empty.description', { agent: props.agentName })}</p>
              <div class="op-suggestions">
                <For each={[
                  t('agent.empty.explain'),
                  t('agent.empty.fixBug'),
                  t('agent.empty.tests'),
                  t('agent.empty.review'),
                ]}>
                  {(text) => (
                    <button type="button" class="op-suggestion" onClick={() => props.onSuggestion(text)}>
                      <Icon name="message" size={14} />
                      <span>{text}</span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          }
        >
          <Index each={props.items}>
            {(item) => (
              <MessageItem
                item={item()}
                agentName={props.agentName}
                terminalOutputs={props.terminalOutputs}
                onCopy={props.onCopy}
                onRetry={props.onRetry}
                onPermission={props.onPermission}
                onForm={props.onForm}
                onCancelForm={props.onCancelForm}
              />
            )}
          </Index>
          <Show when={props.busy}>
            <div class="op-typing"><Spinner size={13} /><span>{t('agent.working')}</span></div>
          </Show>
        </Show>
      </div>
      <Show when={showJump()}>
        <button type="button" class="op-jump" onClick={scrollToBottom} title={t('agent.scrollToBottom')}>
          <Icon name="arrow-down" size={16} />
        </button>
      </Show>
    </div>
  );
}

function ConfirmDialog(props: {
  title: string;
  message: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="op-modal-backdrop" onClick={props.onCancel}>
      <div class="op-modal" onClick={(event) => event.stopPropagation()}>
        <div class="op-modal-title">{props.title}</div>
        <div class="op-modal-message">{props.message}</div>
        <div class="op-modal-actions">
          <button type="button" class="op-btn" onClick={props.onCancel}>{t('agent.cancel')}</button>
          <button type="button" class="op-btn danger" onClick={props.onConfirm}>{props.confirm}</button>
        </div>
      </div>
    </div>
  );
}

function sessionGroup(timestamp?: number): { key: string; label: string } {
  const value = timestamp ?? Date.now();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (value >= today) return { key: 'today', label: t('agent.today') };
  if (value >= today - 86_400_000) return { key: 'yesterday', label: t('agent.yesterday') };
  if (value >= today - 7 * 86_400_000) return { key: 'week', label: t('agent.previous7Days') };
  return { key: 'older', label: t('agent.older') };
}

function ResumePicker(props: {
  agentName: string;
  sessions: Session[];
  currentID: string | null;
  onOpen: (session: Session) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  let listEl!: HTMLDivElement;
  const rows = createMemo(() => {
    const q = query().trim().toLowerCase();
    const list = [...props.sessions]
      .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
      .filter((session) => !q
        || sessionTitle(session).toLowerCase().includes(q)
        || session.id.toLowerCase().includes(q));
    let last = '';
    return list.map((session, index) => {
      const group = sessionGroup(session.time?.updated);
      const first = group.key !== last;
      last = group.key;
      return { session, group, first, index };
    });
  });

  createEffect(() => {
    query();
    setActive(0);
  });

  createEffect(() => {
    const index = active();
    queueMicrotask(() => {
      const row = listEl?.querySelector<HTMLElement>(`[data-resume-index="${index}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    });
  });

  const pick = (index: number) => {
    const row = rows()[index];
    if (row) props.onOpen(row.session);
  };
  const move = (delta: number) => {
    const count = rows().length;
    if (!count) return;
    setActive((active() + delta + count) % count);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); return; }
    if (event.key === 'Enter') { event.preventDefault(); pick(active()); }
  };

  onMount(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener('keydown', onEscape);
    onCleanup(() => window.removeEventListener('keydown', onEscape));
  });

  return (
    <div class="op-resume-backdrop" onClick={props.onClose}>
      <div
        class="op-resume-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('agent.resumeSession')}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="op-resume-title-row">
          <div class="op-resume-heading">
            <span class="op-resume-title">{t('agent.resumeSession')}</span>
            <span class="op-resume-agent">{props.agentName}</span>
          </div>
          <IconButton icon="x" title={t('agent.close')} onClick={props.onClose} />
        </div>
        <div class="op-resume-search">
          <Icon name="search" size={15} />
          <input
            value={query()}
            placeholder={t('agent.searchSessions')}
            aria-label={t('agent.searchSessions')}
            autofocus
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onKey}
          />
          <Show when={query()}>
            <IconButton icon="x" title={t('agent.clearSearch')} onClick={() => setQuery('')} />
          </Show>
        </div>
        <div class="op-resume-list" ref={listEl}>
          <Show
            when={rows().length > 0}
            fallback={
              <div class="op-resume-empty">
                <Icon name="message" size={24} />
                <strong>{query() ? t('agent.noMatchingSessions') : t('agent.noSessions')}</strong>
                <span>{query() ? t('agent.tryDifferentSearch') : t('agent.startNewChat')}</span>
              </div>
            }
          >
            <For each={rows()}>
              {(row) => (
                <>
                  <Show when={row.first}>
                    <div class="op-resume-group">{row.group.label}</div>
                  </Show>
                  <button
                    type="button"
                    class={`op-session-row ${row.index === active() ? 'active' : ''} ${props.currentID === row.session.id ? 'current' : ''}`}
                    data-resume-index={row.index}
                    onClick={() => props.onOpen(row.session)}
                    onMouseEnter={() => setActive(row.index)}
                    title={row.session.id}
                  >
                    <span class="op-session-icon"><Icon name="sparkles" size={16} /></span>
                    <span class="op-session-main">
                      <span class="op-session-title">{sessionTitle(row.session)}</span>
                      <span class="op-session-meta">
                        {formatRelative(row.session.time?.updated)}
                        <span class="op-session-id">{row.session.id}</span>
                      </span>
                    </span>
                    <Show when={props.currentID === row.session.id} fallback={<Icon name="chevron-right" size={15} />}>
                      <Icon name="check" size={15} />
                    </Show>
                  </button>
                </>
              )}
            </For>
          </Show>
        </div>
        <div class="op-resume-foot">
          <span>{rows().length === 1 ? t('agent.sessionCountOne') : t('agent.sessionCount', { n: rows().length })}</span>
          <span>{t('agent.resumeHelp')}</span>
        </div>
      </div>
    </div>
  );
}

function SkillsPanel(props: {
  api: Api;
  onClose: () => void;
  onToast: (message: string, error?: boolean) => void;
}) {
  const [loading, setLoading] = createSignal(true);
  const [installed, setInstalled] = createSignal<InstalledSkill[]>([]);
  const [targets, setTargets] = createSignal<SkillTarget[]>([]);
  const [agentNames, setAgentNames] = createSignal<Record<string, string>>({});
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [source, setSource] = createSignal('');
  const [resolving, setResolving] = createSignal(false);
  const [preview, setPreview] = createSignal<SkillPreview | null>(null);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [selectedTargets, setSelectedTargets] = createSignal<Set<string>>(new Set());
  const [installing, setInstalling] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [warnings, setWarnings] = createSignal<SkillDiagnostic[]>([]);
  const [result, setResult] = createSignal<SkillInstallResult | null>(null);
  const [removing, setRemoving] = createSignal<string | null>(null);
  const [confirmRemove, setConfirmRemove] = createSignal<InstalledSkill | null>(null);
  let disposed = false;

  const selectedCount = createMemo(() => selected().size);
  const targetName = (id: string) =>
    targets().find((target) => target.id === id)?.name ?? agentNames()[id] ?? id;
  const displayAgents = (skill: InstalledSkill): string[] => {
    const ids = new Set(targets().map((target) => target.id));
    const relevant = skill.agents.filter((id) => ids.has(id));
    return relevant.length ? relevant : skill.agents;
  };

  onMount(() => {
    void refresh();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmRemove()) {
        setConfirmRemove(null);
        return;
      }
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  onCleanup(() => {
    disposed = true;
    const token = preview()?.token;
    if (token) void props.api.disposeSkills(token).catch(() => {});
  });

  async function refresh(): Promise<void> {
    try {
      setLoadError(null);
      const list = await props.api.skills();
      if (disposed) return;
      setInstalled(list.skills ?? []);
      setAgentNames(list.agents ?? {});
      const nextTargets = list.targets ?? [];
      setTargets(nextTargets);
      setSelectedTargets((current) => {
        const valid = [...current].filter((id) => nextTargets.some((target) => target.id === id));
        return new Set(valid.length ? valid : nextTargets.map((target) => target.id));
      });
    } catch (failure) {
      if (!disposed) setLoadError(formatError(failure));
    } finally {
      if (!disposed) setLoading(false);
    }
  }

  function toggleSkill(name: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function toggleTarget(id: string, checked: boolean): void {
    setSelectedTargets((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(): void {
    const skills = preview()?.skills ?? [];
    setSelected((current) => current.size === skills.length
      ? new Set<string>()
      : new Set(skills.map((skill) => skill.name)));
  }

  async function resolve(): Promise<void> {
    const value = source().trim();
    if (!value || resolving()) return;
    const previous = preview();
    if (previous) void props.api.disposeSkills(previous.token).catch(() => {});
    setPreview(null);
    setSelected(new Set<string>());
    setResult(null);
    setError(null);
    setWarnings([]);
    setResolving(true);
    try {
      const next = await props.api.resolveSkills(value);
      if (disposed) {
        void props.api.disposeSkills(next.token).catch(() => {});
        return;
      }
      setPreview(next);
      setSelected(new Set((next.skills ?? []).map((skill) => skill.name)));
      setWarnings(next.warnings ?? []);
    } catch (failure) {
      if (!disposed) setError(formatError(failure));
    } finally {
      if (!disposed) setResolving(false);
    }
  }

  async function install(): Promise<void> {
    const value = preview();
    if (!value || installing()) return;
    const names = [...selected()];
    const agents = [...selectedTargets()];
    if (!names.length) {
      setError(t('agent.selectAtLeastOneSkill'));
      return;
    }
    if (!agents.length) {
      setError(t('agent.noTargets'));
      return;
    }
    setInstalling(true);
    setError(null);
    setResult(null);
    setWarnings([]);
    try {
      const outcome = await props.api.installSkills(value.token, names, agents);
      if (disposed) return;
      setResult(outcome);
      setWarnings(outcome.warnings ?? []);
      setPreview(null);
      setSelected(new Set<string>());
      await refresh();
      if (disposed) return;
      const installedNames = new Set(outcome.installed.map((item) => item.skill));
      if (installedNames.size) {
        props.onToast(t('agent.skillInstalled', { n: installedNames.size }));
      }
      if (outcome.failed.length) setError(t('agent.skillInstallFailed'));
    } catch (failure) {
      if (!disposed) {
        setError(formatError(failure));
        // A lock-file failure can happen after the skill folders were written.
        await refresh();
      }
    } finally {
      if (!disposed) setInstalling(false);
    }
  }

  async function remove(skill: InstalledSkill): Promise<void> {
    setConfirmRemove(null);
    setRemoving(skill.name);
    setError(null);
    setResult(null);
    setWarnings([]);
    try {
      const outcome = await props.api.removeSkill(skill.name, skill.agents);
      if (disposed) return;
      if (outcome.removed.length) {
        props.onToast(t('agent.skillRemoved', { name: skill.name }));
      }
      if (outcome.notFound.length || outcome.failed.length) {
        setError(outcome.failed[0]?.message ?? t('agent.skillRemoveFailed'));
      }
      setWarnings(outcome.warnings ?? []);
      await refresh();
    } catch (failure) {
      if (!disposed) {
        setError(formatError(failure));
        await refresh();
      }
    } finally {
      if (!disposed) setRemoving(null);
    }
  }

  return (
    <>
      <div class="op-resume-backdrop" onClick={props.onClose}>
        <div
          class="op-resume-panel op-skills-panel"
          role="dialog"
          aria-modal="true"
          aria-label={t('agent.skills')}
          onClick={(event) => event.stopPropagation()}
        >
          <div class="op-resume-title-row">
            <div class="op-resume-heading">
              <span class="op-resume-title">{t('agent.skills')}</span>
              <span class="op-resume-agent">{t('agent.skillsDescription')}</span>
            </div>
            <IconButton icon="x" title={t('agent.close')} onClick={props.onClose} />
          </div>
          <div class="op-skills-body">
            <Show when={loadError()}>
              <div class="op-skills-error">
                <Icon name="alert" size={15} />
                <span>{loadError()}</span>
              </div>
            </Show>
            <Show
              when={!loading()}
              fallback={<div class="op-skills-loading"><Spinner size={16} /><span>{t('agent.loadingSkills')}</span></div>}
            >
              <section class="op-skills-section">
                <div class="op-skills-section-head">
                  <div class="op-skills-section-title">
                    <Icon name="puzzle" size={15} />
                    <span>{t('agent.installedSkills')}</span>
                    <span class="op-skills-count">{installed().length}</span>
                  </div>
                  <IconButton icon="refresh" title={t('agent.refreshSkills')} onClick={() => void refresh()} />
                </div>
                <Show
                  when={installed().length > 0}
                  fallback={(
                    <div class="op-skills-empty">
                      <Icon name="puzzle" size={22} />
                      <strong>{t('agent.noInstalledSkills')}</strong>
                      <span>{t('agent.noInstalledSkillsHint')}</span>
                    </div>
                  )}
                >
                  <div class="op-skill-list">
                    <For each={installed()}>
                      {(skill) => (
                        <div class="op-skill-row">
                          <div class="op-skill-main">
                            <div class="op-skill-name">{skill.name}</div>
                            <div class="op-skill-desc">{skill.description || t('agent.skillNoDescription')}</div>
                            <div class="op-skill-meta">
                              <For each={displayAgents(skill)}>{(id) => <span class="op-skill-chip">{targetName(id)}</span>}</For>
                              <Show when={skill.source}>
                                <span class="op-skill-source" title={skill.source}>{skill.source}</span>
                              </Show>
                            </div>
                          </div>
                          <Show when={removing() === skill.name}>
                            <Spinner size={12} />
                          </Show>
                          <IconButton
                            icon="trash"
                            title={t('agent.skillRemove')}
                            disabled={removing() !== null || installing()}
                            onClick={() => setConfirmRemove(skill)}
                          />
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </section>

              <section class="op-skills-section op-skills-add">
                <div class="op-skills-section-head">
                  <div class="op-skills-section-title">
                    <Icon name="plus" size={15} />
                    <span>{t('agent.installSkill')}</span>
                  </div>
                </div>
                <div class="op-source-row">
                  <input
                    class="op-input"
                    value={source()}
                    placeholder={t('agent.skillSourcePlaceholder')}
                    aria-label={t('agent.skillSource')}
                    onInput={(event) => setSource(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      void resolve();
                    }}
                  />
                  <button
                    type="button"
                    class="op-btn primary"
                    disabled={!source().trim() || resolving() || installing() || removing() !== null}
                    onClick={() => void resolve()}
                  >
                    <Show when={resolving()} fallback={t('agent.previewSource')}>
                      <Spinner size={12} />
                      <span>{t('agent.resolvingSkills')}</span>
                    </Show>
                  </button>
                </div>
                <div class="op-skills-hint">{t('agent.resolveSkillHint')}</div>

                <Show when={preview()}>
                  {(value) => (
                    <div class="op-skill-preview">
                      <div class="op-skill-preview-head">
                        <span class="op-skill-source" title={value().source.url}>{value().source.url}</span>
                        <span class="op-skill-chip">{value().source.type}</span>
                        <span class="op-skills-count">
                          {value().skills.length === 1
                            ? t('agent.skillCountOne')
                            : t('agent.skillCount', { n: value().skills.length })}
                        </span>
                      </div>
                      <div class="op-skill-preview-actions">
                        <button type="button" class="op-link" onClick={toggleAll}>
                          {selectedCount() === value().skills.length ? t('agent.clearAll') : t('agent.selectAll')}
                        </button>
                        <span class="op-skills-hint">
                          {t('agent.selectedCount', { selected: selectedCount(), total: value().skills.length })}
                        </span>
                      </div>
                      <div class="op-skill-select-list">
                        <For each={value().skills}>
                          {(skill) => (
                            <label class="op-skill-select">
                              <input
                                type="checkbox"
                                checked={selected().has(skill.name)}
                                onChange={(event) => toggleSkill(skill.name, event.currentTarget.checked)}
                              />
                              <span class="op-skill-main">
                                <span class="op-skill-name">{skill.name}</span>
                                <span class="op-skill-desc">{skill.description || t('agent.skillNoDescription')}</span>
                                <Show when={skill.path}><span class="op-skill-path">{skill.path}</span></Show>
                              </span>
                              <Show when={skill.duplicates?.length}>
                                <span class="op-skill-chip warn" title={skill.duplicates?.join('\n')}>
                                  {t('agent.skillDuplicate')}
                                </span>
                              </Show>
                            </label>
                          )}
                        </For>
                      </div>
                      <Show when={targets().length > 1}>
                        <div class="op-skill-targets">
                          <span class="op-field-label">{t('agent.installTargets')}</span>
                          <div class="op-skill-target-list">
                            <For each={targets()}>
                              {(target) => (
                                <label class="op-check op-skill-target">
                                  <input
                                    type="checkbox"
                                    checked={selectedTargets().has(target.id)}
                                    onChange={(event) => toggleTarget(target.id, event.currentTarget.checked)}
                                  />
                                  <span class="op-skill-target-main">
                                    <span>{target.name}</span>
                                    <code>{target.dir}</code>
                                  </span>
                                </label>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                      <div class="op-skill-preview-foot">
                        <span class="op-skills-hint">{t('agent.installHint')}</span>
                        <button
                          type="button"
                          class="op-btn primary"
                          disabled={installing() || removing() !== null || !selectedCount() || !selectedTargets().size}
                          onClick={() => void install()}
                        >
                          <Show when={installing()} fallback={t('agent.installSelected')}>
                            <Spinner size={12} />
                            <span>{t('agent.installingSkills')}</span>
                          </Show>
                        </button>
                      </div>
                    </div>
                  )}
                </Show>

                <Show when={error()}>
                  <div class="op-skills-error">
                    <Icon name="alert" size={15} />
                    <span>{error()}</span>
                  </div>
                </Show>
                <Show when={warnings().length > 0}>
                  <div class="op-skills-warnings">
                    <div class="op-skills-warnings-title">{t('agent.skillWarnings')}</div>
                    <For each={warnings()}>
                      {(warning) => (
                        <div class="op-skills-warning" title={warning.fix}>
                          <code>{warning.code}</code>
                          <span>{warning.message}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={result()}>
                  {(value) => (
                    <div class="op-skill-result">
                      <div class="op-skill-result-title">{t('agent.skillResult')}</div>
                      <For each={value().installed}>
                        {(item) => (
                          <div class="op-skill-result-row">
                            <Icon name="check" size={14} />
                            <span>{item.skill}</span>
                            <span class="op-skill-chip">{targetName(item.agent)}</span>
                            <code>{item.path}</code>
                          </div>
                        )}
                      </For>
                      <For each={value().skipped}>
                        {(item) => (
                          <div class="op-skill-result-row warn">
                            <Icon name="info" size={14} />
                            <span>{item.skill}</span>
                            <span>{targetName(item.agent)} · {t('agent.skillTargetMissing')}</span>
                          </div>
                        )}
                      </For>
                      <For each={value().failed}>
                        {(item) => (
                          <div class="op-skill-result-row error">
                            <Icon name="alert" size={14} />
                            <span>{item.skill}</span>
                            <span>{item.message}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Show>
              </section>
            </Show>
          </div>
        </div>
      </div>
      <Show when={confirmRemove()}>
        {(skill) => (
          <ConfirmDialog
            title={t('agent.skillRemoveTitle')}
            message={t('agent.skillRemoveMessage', { name: skill().name })}
            confirm={t('agent.skillRemove')}
            onConfirm={() => void remove(skill())}
            onCancel={() => setConfirmRemove(null)}
          />
        )}
      </Show>
    </>
  );
}

function SystemPromptPanel(props: {
  text: string;
  supported: boolean;
  saving: boolean;
  error: string | null;
  onSave: (text: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = createSignal(props.text);
  const [dirty, setDirty] = createSignal(false);
  createEffect(on(() => props.text, (text) => {
    if (!dirty()) setDraft(text);
  }, { defer: true }));
  const close = () => {
    if (!props.saving) props.onClose();
  };

  return (
    <div class="op-resume-backdrop" onClick={close}>
      <div
        class="op-resume-panel op-prompt-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('agent.systemPrompt')}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="op-resume-title-row">
          <div class="op-resume-heading">
            <span class="op-resume-title">{t('agent.systemPrompt')}</span>
            <span class="op-resume-agent">{t('agent.systemPromptScope')}</span>
          </div>
          <IconButton icon="x" title={t('agent.close')} onClick={close} />
        </div>
        <div class="op-prompt-body">
          <div class="op-mcp-note">
            <Icon name="info" size={14} />
            <span>{t('agent.systemPromptHint')}</span>
          </div>
          <textarea
            class="op-input op-prompt-textarea"
            value={draft()}
            maxLength={MAX_SYSTEM_PROMPT}
            placeholder={t('agent.systemPromptPlaceholder')}
            aria-label={t('agent.systemPrompt')}
            onInput={(event) => {
              setDraft(event.currentTarget.value);
              setDirty(true);
            }}
          />
          <span class="op-prompt-count">{draft().length} / {MAX_SYSTEM_PROMPT}</span>
          <Show when={!props.supported}>
            <div class="op-mcp-hint">{t('agent.systemPromptUnsupported')}</div>
          </Show>
          <Show when={props.error}>
            <div class="op-skills-error"><Icon name="alert" size={14} /><span>{props.error}</span></div>
          </Show>
        </div>
        <div class="op-mcp-foot">
          <button
            type="button"
            class="op-btn"
            disabled={props.saving}
            onClick={() => props.onSave(null)}
          >
            {t('agent.systemPromptClear')}
          </button>
          <div class="op-mcp-foot-actions">
            <button type="button" class="op-btn" disabled={props.saving} onClick={close}>{t('agent.cancel')}</button>
            <button
              type="button"
              class="op-btn primary"
              disabled={props.saving || !draft().trim()}
              onClick={() => props.onSave(draft())}
            >
              <Show when={props.saving} fallback={t('agent.mcpSave')}><Spinner size={12} /></Show>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function McpPanel(props: {
  servers: McpServer[];
  saving: boolean;
  error: string | null;
  capabilities?: { http?: boolean; sse?: boolean };
  onSave: (servers: McpServer[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = createSignal<McpServer[]>([...props.servers]);
  const [dirty, setDirty] = createSignal(false);
  const [name, setName] = createSignal('');
  const [transport, setTransport] = createSignal<'stdio' | 'http' | 'sse'>('stdio');
  const [command, setCommand] = createSignal('');
  const [args, setArgs] = createSignal('');
  const [env, setEnv] = createSignal('');
  const [url, setUrl] = createSignal('');
  const [headers, setHeaders] = createSignal('');
  const [formError, setFormError] = createSignal<string | null>(null);

  createEffect(on(() => props.servers, (servers) => {
    if (!dirty()) setList([...servers]);
  }, { defer: true }));

  const add = (): void => {
    const serverName = name().trim();
    if (!serverName || (transport() === 'stdio' ? !command().trim() : !url().trim())) {
      setFormError(t('agent.mcpMissing'));
      return;
    }
    if (list().some((server) => server.name === serverName)) {
      setFormError(t('agent.mcpDuplicate'));
      return;
    }
    const next: McpServer = transport() === 'stdio'
      ? {
          type: 'stdio',
          name: serverName,
          command: command().trim(),
          args: parseLines(args()),
          env: parseKeyValueLines(env(), '='),
        }
      : {
          type: transport() as 'http' | 'sse',
          name: serverName,
          url: url().trim(),
          headers: parseKeyValueLines(headers(), ':'),
        };
    setList((current) => [...current, next]);
    setDirty(true);
    setName('');
    setCommand('');
    setArgs('');
    setEnv('');
    setUrl('');
    setHeaders('');
    setFormError(null);
  };

  const remove = (index: number): void => {
    setList((current) => current.filter((_, item) => item !== index));
    setDirty(true);
  };

  const unsupported = createMemo(() => {
    if (!props.capabilities) return false;
    if (transport() === 'http') return props.capabilities.http !== true;
    if (transport() === 'sse') return props.capabilities.sse !== true;
    return false;
  });

  const unsupportedServer = (server: McpServer): boolean => {
    if (!props.capabilities) return false;
    if (server.type === 'http') return props.capabilities.http !== true;
    if (server.type === 'sse') return props.capabilities.sse !== true;
    return false;
  };

  return (
    <div class="op-resume-backdrop" onClick={props.onClose}>
      <div
        class="op-resume-panel op-mcp-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('agent.mcpServers')}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="op-resume-title-row">
          <div class="op-resume-heading">
            <span class="op-resume-title">{t('agent.mcpServers')}</span>
            <span class="op-resume-agent">{t('agent.mcpAppliesToNew')}</span>
          </div>
          <IconButton icon="x" title={t('agent.close')} onClick={props.onClose} />
        </div>
        <div class="op-mcp-body">
          <div class="op-mcp-note">
            <Icon name="shield" size={14} />
            <span>{t('agent.mcpSecurity')}</span>
          </div>
          <Show
            when={list().length > 0}
            fallback={<div class="op-skills-empty"><Icon name="server" size={22} /><strong>{t('agent.mcpEmpty')}</strong></div>}
          >
            <div class="op-mcp-list">
              <For each={list()}>
                {(server, index) => (
                  <div class="op-mcp-row">
                    <div class="op-mcp-icon"><Icon name="server" size={15} /></div>
                    <div class="op-mcp-main">
                      <span class="op-mcp-name">{server.name}</span>
                      <span class="op-mcp-target">
                        {server.type === 'stdio' ? `${server.command} ${server.args.join(' ')}` : server.url}
                      </span>
                    </div>
                    <span class="op-skill-chip">{server.type}</span>
                    <Show when={unsupportedServer(server)}>
                      <span
                        class="op-mcp-warn"
                        title={server.type === 'http' ? t('agent.mcpUnsupportedHttp') : t('agent.mcpUnsupportedSse')}
                      >
                        <Icon name="alert" size={12} />
                      </span>
                    </Show>
                    <IconButton
                      icon="trash"
                      title={t('agent.mcpRemove')}
                      onClick={() => remove(index())}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div class="op-mcp-form">
            <div class="op-mcp-form-row">
              <input
                class="op-input"
                value={name()}
                placeholder={t('agent.mcpName')}
                aria-label={t('agent.mcpName')}
                onInput={(event) => setName(event.currentTarget.value)}
              />
              <select
                class="op-input op-mcp-transport"
                value={transport()}
                aria-label={t('agent.mcpTransport')}
                onChange={(event) => setTransport(event.currentTarget.value as 'stdio' | 'http' | 'sse')}
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
                <option value="sse">sse</option>
              </select>
            </div>
            <Show
              when={transport() === 'stdio'}
              fallback={
                <>
                  <input
                    class="op-input"
                    value={url()}
                    placeholder={t('agent.mcpUrl')}
                    aria-label={t('agent.mcpUrl')}
                    onInput={(event) => setUrl(event.currentTarget.value)}
                  />
                  <textarea
                    class="op-input op-mcp-textarea"
                    value={headers()}
                    placeholder={t('agent.mcpHeaders')}
                    aria-label={t('agent.mcpHeaders')}
                    onInput={(event) => setHeaders(event.currentTarget.value)}
                  />
                </>
              }
            >
              <input
                class="op-input"
                value={command()}
                placeholder={t('agent.mcpCommand')}
                aria-label={t('agent.mcpCommand')}
                onInput={(event) => setCommand(event.currentTarget.value)}
              />
              <textarea
                class="op-input op-mcp-textarea"
                value={args()}
                placeholder={t('agent.mcpArgs')}
                aria-label={t('agent.mcpArgs')}
                onInput={(event) => setArgs(event.currentTarget.value)}
              />
              <textarea
                class="op-input op-mcp-textarea"
                value={env()}
                placeholder={t('agent.mcpEnv')}
                aria-label={t('agent.mcpEnv')}
                onInput={(event) => setEnv(event.currentTarget.value)}
              />
            </Show>
            <Show when={unsupported()}>
              <div class="op-mcp-hint">
                {transport() === 'http' ? t('agent.mcpUnsupportedHttp') : t('agent.mcpUnsupportedSse')}
              </div>
            </Show>
            <div class="op-mcp-form-actions">
              <button type="button" class="op-btn" onClick={add}>{t('agent.mcpAdd')}</button>
            </div>
          </div>

          <Show when={formError()}>
            <div class="op-skills-error"><Icon name="alert" size={14} /><span>{formError()}</span></div>
          </Show>
          <Show when={props.error}>
            <div class="op-skills-error"><Icon name="alert" size={14} /><span>{props.error}</span></div>
          </Show>
        </div>
        <div class="op-mcp-foot">
          <span>{t('agent.mcpAppliesToNew')}</span>
          <div class="op-mcp-foot-actions">
            <button type="button" class="op-btn" onClick={props.onClose}>{t('agent.cancel')}</button>
            <button
              type="button"
              class="op-btn primary"
              disabled={props.saving}
              onClick={() => props.onSave(list())}
            >
              <Show when={props.saving} fallback={t('agent.mcpSave')}><Spinner size={12} /></Show>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function App(props: {
  api: Api;
  storageKey: string;
  runtimeStorageKey: string;
  mcpStorageKey: string;
  systemPromptStorageKey: string;
  theme: string;
  lang: string;
  path: string;
  onTabs?: FeatureUiProps['onTabs'];
  onToolbar?: FeatureUiProps['onToolbar'];
  onOpenPath?: FeatureUiProps['onOpenPath'];
  onClosePath?: FeatureUiProps['onClosePath'];
  onUpdateTab?: FeatureUiProps['onUpdateTab'];
}) {
  const [ready, setReady] = createSignal(false);
  const [initError, setInitError] = createSignal<string | null>(null);
  const [sessions, setSessions] = createSignal<Session[]>([]);
  const [currentID, setCurrentID] = createSignal<string | null>(null);
  const [items, setItems] = createSignal<ChatItem[]>([]);
  const [models, setModels] = createSignal<Model[]>([]);
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [commands, setCommands] = createSignal<Command[]>([]);
  const [selectedModel, setSelectedModel] = createSignal<Model | null>(null);
  const [modes, setModes] = createSignal<AgentModeState | null>(null);
  const [defaultModes, setDefaultModes] = createSignal<AgentModeState | null>(null);
  const [defaultConfigOptions, setDefaultConfigOptions] = createSignal<ConfigOption[]>([]);
  const [draftSessionID, setDraftSessionID] = createSignal<string | null>(null);
  const [configBusy, setConfigBusy] = createSignal(false);
  const [attachments, setAttachments] = createSignal<PromptAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [toast, setToast] = createSignal<{ text: string; error: boolean } | null>(null);
  const [terminalOutputs, setTerminalOutputs] = createSignal<Record<string, TerminalOutput>>({});
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
  const [permissions, setPermissions] = createSignal<PermissionRequest[]>([]);
  const [forms, setForms] = createSignal<FormInfo[]>([]);
  const [agentName, setAgentName] = createSignal('Agent');
  const [runtimeAgents, setRuntimeAgents] = createSignal<DiscoveredAgent[]>([]);
  const [selectedRuntime, setSelectedRuntime] = createSignal<string | null>(null);
  const [switchingAgent, setSwitchingAgent] = createSignal(false);
  const [capabilities, setCapabilities] = createSignal<Record<string, any> | null>(null);
  const [authMethods, setAuthMethods] = createSignal<AuthMethod[]>([]);
  const [authenticated, setAuthenticated] = createSignal(false);
  const [authRequired, setAuthRequired] = createSignal(false);
  const [authBusy, setAuthBusy] = createSignal(false);
  const [authDismissed, setAuthDismissed] = createSignal(false);
  const [mcpOpen, setMcpOpen] = createSignal(false);
  const [mcpServers, setMcpServers] = createSignal<McpServer[]>([]);
  const [mcpReady, setMcpReady] = createSignal(false);
  const [mcpLoading, setMcpLoading] = createSignal(false);
  const [mcpSaving, setMcpSaving] = createSignal(false);
  const [mcpError, setMcpError] = createSignal<string | null>(null);
  const [promptOpen, setPromptOpen] = createSignal(false);
  const [promptText, setPromptText] = createSignal('');
  const [promptReady, setPromptReady] = createSignal(false);
  const [promptLoading, setPromptLoading] = createSignal(false);
  const [promptSaving, setPromptSaving] = createSignal(false);
  const [promptError, setPromptError] = createSignal<string | null>(null);
  let events: EventSource | undefined;
  let disposed = false;
  const updatesBySession = new Map<string, any[]>();

  const routeSessionID = createMemo(() => sessionPathID(props.path));
  const routeMissing = createMemo(() => {
    const id = routeSessionID();
    return !!id && ready() && !sessions().some((session) => session.id === id);
  });
  const currentSession = createMemo(() => sessions().find((session) => session.id === currentID()) ?? null);
  const sessionReady = createMemo(() => {
    const id = routeSessionID();
    return !id || (currentID() === id && !!currentSession());
  });
  const currentBusy = createMemo(() => busy());
  const [resumeOpen, setResumeOpen] = createSignal(false);
  const [skillsOpen, setSkillsOpen] = createSignal(false);
  const currentModelLabel = createMemo(() => modelLabel(selectedModel()));
  const authBlocked = createMemo(() => !authenticated() && (authRequired() || authMethods().length > 0));
  const showAuth = createMemo(() => authBlocked() && !authDismissed());
  const canLogout = createMemo(() => {
    const auth = capabilities()?.auth as { logout?: unknown } | undefined;
    return !!auth?.logout;
  });
  const promptCapabilities = createMemo<PromptCapabilities>(() =>
    (capabilities()?.promptCapabilities as PromptCapabilities | undefined) ?? {});
  const mcpCapabilities = createMemo(() =>
    (capabilities()?.mcpCapabilities as { http?: boolean; sse?: boolean } | undefined) ?? {});
  const canCloseSession = createMemo(() => {
    const caps = capabilities()?.sessionCapabilities as Record<string, unknown> | undefined;
    return Boolean(caps?.close && caps?.list && (capabilities()?.loadSession || caps?.resume));
  });
  onMount(() => {
    void initialize();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConfirmDelete(null);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === props.mcpStorageKey) {
        setMcpServers(loadMcpServers(window.localStorage, props.mcpStorageKey));
      } else if (event.key === props.systemPromptStorageKey) {
        setPromptText(loadSystemPrompt(window.localStorage, props.systemPromptStorageKey));
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('storage', onStorage);
    onCleanup(() => {
      disposed = true;
      events?.close();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('storage', onStorage);
    });
  });

  createEffect(() => {
    const message = toast();
    if (!message) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    onCleanup(() => window.clearTimeout(timer));
  });

  // Selecting a session tab updates path; follow path changes only, so creating
  // or deleting a session does not get reverted by the old path.
  createEffect(on(() => props.path, (path) => {
    const requested = sessionPathID(path);
    if (!ready()) return;
    if (!requested) {
      if (currentID()) {
        setCurrentID(null);
        setItems([]);
        setPermissions([]);
        setForms([]);
        setBusy(false);
      }
      setModes(defaultModes());
      setResumeOpen(false);
      return;
    }
    if (requested === currentID()) return;
    if (sessions().some((session) => session.id === requested)) {
      void selectSession(requested);
      return;
    }
    setCurrentID(null);
    setItems([]);
    setPermissions([]);
    setForms([]);
    setBusy(false);
  }, { defer: true }));

  // Actions live in anther's main toolbar while this panel is active.
  createEffect(() => {
    const session = currentSession();
    const actions: FeatureToolbarAction[] = [{
      id: 'new',
      title: t('agent.newChat'),
      icon: 'plus',
      disabled: switchingAgent(),
      onClick: () => newChat(),
    }, {
      id: 'skills',
      title: t('agent.skills'),
      icon: 'puzzle',
      disabled: switchingAgent(),
      onClick: () => setSkillsOpen(true),
    }, {
      id: 'mcp',
      title: t('agent.mcpServers'),
      icon: 'server',
      disabled: switchingAgent() || !ready() || !mcpReady() || mcpLoading(),
      onClick: () => void openMcp(),
    }];
    const caps = capabilities()?.sessionCapabilities as Record<string, unknown> | undefined;
    if (promptReady() && (caps?.systemPrompt || promptText().trim())) {
      actions.push({
        id: 'system-prompt',
        title: t('agent.systemPrompt'),
        icon: 'edit',
        disabled: switchingAgent() || !promptReady() || promptLoading() || promptSaving(),
        onClick: () => void openSystemPrompt(),
      });
    }
    if (session) {
      if (caps?.fork) {
        actions.push({ id: 'fork', title: t('agent.forkChat'), icon: 'git-branch', disabled: currentBusy() || switchingAgent(), onClick: () => void forkSession(session.id) });
      }
      if (caps?.delete) {
        actions.push({ id: 'delete', title: t('agent.deleteChat'), icon: 'trash', danger: true, disabled: currentBusy() || switchingAgent(), onClick: () => setConfirmDelete(session.id) });
      }
    }
    if (authenticated() && canLogout()) {
      actions.push({
        id: 'logout',
        title: t('agent.signOut'),
        icon: 'lock',
        disabled: authBusy() || switchingAgent(),
        onClick: () => void logout(),
      });
    }
    untrack(() => props.onToolbar?.(actions));
  });

  async function initialize(targetPath = props.path): Promise<void> {
    try {
      setInitError(null);
      setCapabilities(null);
      setMcpReady(false);
      setPromptReady(false);
      const discovery = await props.api.discovery().catch((): AgentDiscovery => ({ agents: [] }));
      if (disposed) return;
      const discovered = discovery.agents ?? [];
      setRuntimeAgents(discovered);
      const stored = loadStoredAgent(props.runtimeStorageKey, discovered);
      const preferred = stored ?? discovery.selectedAgent ?? discovered[0]?.id ?? null;
      if (preferred && preferred !== discovery.selectedAgent) {
        try {
          await props.api.selectAgent(preferred);
        } catch {
          // status below reports the server's selected agent
        }
        if (disposed) return;
      }

      const storedMcp = loadMcpServers(window.localStorage, props.mcpStorageKey);
      try {
        const mcp = storedMcp.length > 0
          ? await props.api.setMcp(storedMcp)
          : await props.api.mcp();
        if (disposed) return;
        setMcpServers(mcp.data ?? []);
        if (storedMcp.length > 0) {
          storeMcpServers(window.localStorage, props.mcpStorageKey, mcp.data ?? []);
        }
      } catch (error) {
        if (disposed) return;
        setMcpError(formatError(error));
        // The local copy may be stale or invalid; fall back to the server list
        // so the manager never shows an empty list while the server has config.
        try {
          const mcp = await props.api.mcp();
          if (disposed) return;
          const list = mcp.data ?? [];
          setMcpServers(list);
          // Do not overwrite a valid local copy with an empty server list after
          // a failed sync; the next reload can retry the PUT.
          if (list.length > 0) {
            storeMcpServers(window.localStorage, props.mcpStorageKey, list);
          }
        } catch {
          // MCP config is optional; status below still loads the agent.
        }
      }
      if (disposed) return;
      setMcpReady(true);

      const storedPrompt = loadSystemPrompt(window.localStorage, props.systemPromptStorageKey);
      try {
        const result = storedPrompt
          ? await props.api.setSystemPrompt(storedPrompt)
          : await props.api.systemPrompt();
        if (disposed) return;
        const text = result.data ?? '';
        setPromptText(text);
        if (text || storedPrompt) {
          storeSystemPrompt(window.localStorage, props.systemPromptStorageKey, text);
        }
      } catch (error) {
        if (disposed) return;
        setPromptError(formatError(error));
        try {
          const result = await props.api.systemPrompt();
          if (disposed) return;
          const text = result.data ?? '';
          setPromptText(text);
          if (text) storeSystemPrompt(window.localStorage, props.systemPromptStorageKey, text);
        } catch {
          // The system prompt is optional; status below still loads the agent.
        }
      }
      if (disposed) return;
      setPromptReady(true);

      const status = await props.api.status();
      if (disposed) return;
      const statusAgents = status.availableAgents?.length ? status.availableAgents : discovered;
      setRuntimeAgents(statusAgents);
      setSelectedRuntime(status.selectedAgent ?? preferred ?? statusAgents[0]?.id ?? null);
      if (!status.ready) {
        setInitError(status.error || t('agent.agentUnavailable'));
        setReady(true);
        return;
      }
      setAgentName(status.agent?.title || status.agent?.name || t('agent.name'));
      setCapabilities(status.capabilities ?? null);
      setModes(status.modes ?? null);
      setDefaultModes(status.modes ?? null);
      setDefaultConfigOptions(status.configOptions ?? []);
      setDraftSessionID(status.bootstrapSessionID ?? null);
      setAuthMethods(status.authMethods ?? []);
      setAuthenticated(status.authenticated === true);
      setAuthRequired(status.authRequired === true);
      setAuthDismissed(false);
      if (status.authRequired && !status.authenticated) {
        setSessions([]);
        setCurrentID(null);
        setItems([]);
        setPermissions([]);
        setForms([]);
        setReady(true);
        connect();
        return;
      }
      const [modelList, providerList, commandList, sessionList] = await Promise.all([
        props.api.models(),
        props.api.providers(),
        props.api.commands(),
        props.api.sessions(),
      ]);
      if (disposed) return;
      const chatModels = (modelList.data ?? []).filter((model) =>
        model.enabled !== false && (model.type ?? 'chat') === 'chat');
      setModels(chatModels);
      setProviders(providerList.data ?? []);
      setCommands(commandList.data ?? []);
      setSelectedModel(loadStoredModel(props.storageKey, chatModels) ?? chooseDefaultModel(chatModels, status));
      const list = sessionList.data ?? [];
      setSessions(list);
      const requested = sessionPathID(targetPath);
      const target = requested && list.some((session) => session.id === requested)
        ? requested
        : null;
      setReady(true);
      if (target) await selectSession(target);
      connect();
    } catch (error) {
      if (!disposed) {
        setInitError(formatError(error));
        setReady(true);
      }
    }
  }

  async function changeRuntimeAgent(id: string): Promise<void> {
    const previous = selectedRuntime();
    if (!id || id === previous || switchingAgent()) return;
    if (currentBusy()) {
      showToast(t('agent.switchBlocked'), true);
      return;
    }
    const oldSessions = sessions();
    const nextName = runtimeAgents().find((agent) => agent.id === id)?.name;
    setSwitchingAgent(true);
    setSelectedRuntime(id);
    try {
      await props.api.selectAgent(id);
      storeAgent(props.runtimeStorageKey, id);
      if (nextName) setAgentName(nextName);
      setInitError(null);
      for (const session of oldSessions) {
        props.onClosePath?.(`/${encodeURIComponent(session.id)}`);
      }
      props.onOpenPath?.('');
      setResumeOpen(false);
      setSessions([]);
      setCurrentID(null);
      setItems([]);
      setPermissions([]);
      setForms([]);
      setBusy(false);
      setCommands([]);
      setModels([]);
      setProviders([]);
      setSelectedModel(null);
      setModes(null);
      setTerminalOutputs({});
      setAttachments([]);
      setAttachmentBusy(false);
      setDefaultModes(null);
      setDefaultConfigOptions([]);
      setDraftSessionID(null);
      setConfigBusy(false);
      setCapabilities(null);
      setAuthMethods([]);
      setAuthenticated(false);
      setAuthRequired(false);
      setAuthDismissed(false);
      setAuthBusy(false);
      setError(null);
      await initialize('');
    } catch (error) {
      setSelectedRuntime(previous);
      showToast(formatError(error), true);
    } finally {
      setSwitchingAgent(false);
    }
  }

  async function authenticate(methodID: string): Promise<void> {
    if (authBusy()) return;
    setAuthBusy(true);
    setError(null);
    try {
      await props.api.authenticate(methodID);
      setAuthDismissed(false);
      await initialize();
    } catch (failure) {
      setError(formatError(failure));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout(): Promise<void> {
    if (authBusy()) return;
    setAuthBusy(true);
    setError(null);
    try {
      await props.api.logout();
      await initialize();
    } catch (failure) {
      setError(formatError(failure));
    } finally {
      setAuthBusy(false);
    }
  }

  function applyDraftStatus(status: Status | null): void {
    if (status?.ready) {
      setDraftSessionID(status.bootstrapSessionID ?? null);
      setDefaultModes(status.modes ?? null);
      setDefaultConfigOptions(status.configOptions ?? []);
      if (!currentID()) {
        const nextModel = modelFromConfig(status.configOptions ?? [], models());
        if (nextModel) setSelectedModel(nextModel);
      }
    } else {
      // The old draft bootstrap was deleted; do not keep pointing at it.
      setDraftSessionID(null);
    }
  }

  async function openMcp(): Promise<void> {
    if (mcpLoading() || mcpSaving()) return;
    setMcpLoading(true);
    setMcpError(null);
    try {
      const result = await props.api.mcp();
      if (disposed) return;
      setMcpServers(result.data ?? []);
      storeMcpServers(window.localStorage, props.mcpStorageKey, result.data ?? []);
    } catch (error) {
      if (!disposed) setMcpError(formatError(error));
    } finally {
      if (!disposed) setMcpLoading(false);
    }
    if (!disposed) setMcpOpen(true);
  }

  async function saveMcp(servers: McpServer[]): Promise<void> {
    if (mcpSaving()) return;
    setMcpSaving(true);
    setMcpError(null);
    try {
      const result = await props.api.setMcp(servers);
      if (disposed) return;
      setMcpServers(result.data ?? []);
      storeMcpServers(window.localStorage, props.mcpStorageKey, result.data ?? []);
      const status = await props.api.status().catch(() => null);
      if (disposed) return;
      applyDraftStatus(status);
      setMcpOpen(false);
      showToast(t('agent.mcpSaved'));
    } catch (error) {
      if (!disposed) setMcpError(formatError(error));
    } finally {
      if (!disposed) setMcpSaving(false);
    }
  }

  async function openSystemPrompt(): Promise<void> {
    if (promptOpen() || promptLoading() || promptSaving()) return;
    setPromptLoading(true);
    setPromptError(null);
    try {
      const result = await props.api.systemPrompt();
      if (disposed) return;
      const text = result.data ?? '';
      setPromptText(text);
      const local = loadSystemPrompt(window.localStorage, props.systemPromptStorageKey);
      if (text || !local) {
        storeSystemPrompt(window.localStorage, props.systemPromptStorageKey, text);
      }
    } catch (error) {
      if (!disposed) setPromptError(formatError(error));
    } finally {
      if (!disposed) setPromptLoading(false);
    }
    if (!disposed) setPromptOpen(true);
  }

  async function saveSystemPrompt(text: string | null): Promise<void> {
    if (promptSaving()) return;
    setPromptSaving(true);
    setPromptError(null);
    try {
      const wasFatal = Boolean(initError());
      const result = await props.api.setSystemPrompt(text);
      if (disposed) return;
      const value = result.data ?? '';
      setPromptText(value);
      storeSystemPrompt(window.localStorage, props.systemPromptStorageKey, value);
      const status = await props.api.status().catch(() => null);
      if (disposed) return;
      if (!status?.ready) {
        setPromptError(status?.error || t('agent.agentError'));
        return;
      }
      setInitError(null);
      setCapabilities(status.capabilities ?? null);
      setPromptOpen(false);
      showToast(t('agent.systemPromptSaved'));
      if (wasFatal) {
        await initialize();
      } else {
        applyDraftStatus(status);
        const id = currentID();
        if (id) await loadHistory(id);
      }
    } catch (error) {
      if (!disposed) setPromptError(formatError(error));
    } finally {
      if (!disposed) setPromptSaving(false);
    }
  }

  function connect(): void {
    events?.close();
    const source = new EventSource(props.api.eventsUrl());
    events = source;
    source.onopen = () => {
      void refreshSessions();
      if (currentID()) {
        void loadHistory(currentID()!);
        void loadPending(currentID()!);
      }
    };
    source.onerror = () => {
      // EventSource reconnects automatically; the next onopen resyncs sessions.
    };
    source.onmessage = (message) => {
      let event: AgentEvent;
      try {
        event = JSON.parse(message.data) as AgentEvent;
      } catch {
        return;
      }
      handleEvent(event);
    };
  }

  async function refreshSessions(): Promise<void> {
    try {
      const result = await props.api.sessions();
      if (disposed) return;
      const next = result.data ?? [];
      const id = currentID();
      if (id && !next.some((session) => session.id === id)) {
        const existing = sessions().find((session) => session.id === id);
        next.unshift(existing ?? { id, title: t('agent.newChat') });
      }
      const previous = new Map(sessions().map((session) => [session.id, session.title]));
      setSessions(next);
      for (const session of next) {
        if (previous.get(session.id) === session.title) continue;
        props.onUpdateTab?.(`/${encodeURIComponent(session.id)}`, { title: sessionTitle(session) });
      }
    } catch {
      // Keep the current list; EventSource reconnect will resync.
    }
  }

  async function loadHistory(id: string): Promise<void> {
    try {
      const result = await props.api.messages(id);
      if (disposed || currentID() !== id) return;
      const configOptions = result.configOptions ?? [];
      if (result.modes) {
        setModes(result.modes);
        setSessions((prev) => prev.map((item) =>
          item.id === id ? { ...item, modes: result.modes } : item));
      }
      if (configOptions.length > 0) {
        setSessions((prev) => prev.map((item) =>
          item.id === id ? { ...item, configOptions } : item));
        const model = modelFromConfig(configOptions, models());
        if (model) setSelectedModel(model);
      }
      const updates = result.data ?? [];
      const normalized = normalizeHistory(updates);
      updatesBySession.set(id, updates);
      setItems(normalized);
    } catch (error) {
      if (!disposed && currentID() === id) showToast(formatError(error), true);
    }
  }

  async function loadPending(id: string): Promise<void> {
    try {
      const [permissionList, formList] = await Promise.all([
        props.api.permissions(id).catch(() => ({ data: [] })),
        props.api.forms(id).catch(() => ({ data: [] })),
      ]);
      if (disposed || currentID() !== id) return;
      setPermissions(permissionList.data ?? []);
      setForms((formList.data ?? []).filter((form) => {
        const status = form.state?.status;
        return status !== 'answered' && status !== 'cancelled';
      }));
    } catch {
      // pending cards are best effort
    }
  }

  function openSession(session: Session): void {
    const path = `/${encodeURIComponent(session.id)}`;
    if (props.onOpenPath) {
      props.onOpenPath(path, { title: sessionTitle(session) });
      void selectSession(session.id);
      return;
    }
    void selectSession(session.id);
  }

  function openResume(): void {
    setResumeOpen(true);
  }

  async function selectSession(id: string): Promise<void> {
    if (id === currentID()) return;
    const session = sessions().find((item) => item.id === id);
    if (session) props.onUpdateTab?.(`/${encodeURIComponent(id)}`, { title: sessionTitle(session) });
    setModes(session?.modes ?? defaultModes());
    setCurrentID(id);
    setItems([]);
    setPermissions([]);
    setForms([]);
    setError(null);
    setBusy(false);
    await Promise.all([loadHistory(id), loadPending(id)]);
  }

  function newChat(): void {
    setDraft('');
    setError(null);
    setResumeOpen(false);
    if (props.onOpenPath) {
      props.onOpenPath('');
      return;
    }
    setCurrentID(null);
    setItems([]);
    setPermissions([]);
    setForms([]);
    setBusy(false);
    setModes(defaultModes());
  }

  async function createSession(): Promise<Session | null> {
    if (switchingAgent()) return null;
    try {
      const session = await props.api.createSession();
      if (disposed) return null;
      setSessions((prev) => [session, ...prev.filter((item) => item.id !== session.id)]);
      setCurrentID(session.id);
      setDraftSessionID(null);
      updatesBySession.set(session.id, []);
      setItems([]);
      setPermissions([]);
      setForms([]);
      setBusy(false);
      props.onOpenPath?.(`/${encodeURIComponent(session.id)}`, { title: sessionTitle(session) });
      const sessionModel = modelFromConfig(session.configOptions, models());
      if (sessionModel) setSelectedModel(sessionModel);
      const initialModes = session.modes ?? defaultModes();
      setModes(initialModes);
      const preferredMode = defaultModes()?.currentModeId;
      if (initialModes && preferredMode
        && initialModes.currentModeId !== preferredMode
        && initialModes.availableModes.some((mode) => mode.id === preferredMode)) {
        try {
          const result = await props.api.setMode(session.id, preferredMode);
          session.modes = result.modes;
          setModes(result.modes);
          setSessions((prev) => prev.map((item) =>
            item.id === session.id ? { ...item, modes: result.modes } : item));
        } catch {
          // Keep the agent's default mode for this new session.
        }
      }
      const preferred = loadStoredModel(props.storageKey, models());
      if (preferred && !sameModel(sessionModel, preferred)) {
        try {
          const result = await props.api.setConfig(session.id, 'model', modelKey(preferred));
          if (result.data) {
            session.configOptions = result.data;
            setSessions((prev) => prev.map((item) =>
              item.id === session.id ? { ...item, configOptions: result.data } : item));
          }
          setSelectedModel(preferred);
        } catch {
          // Keep the agent's session default when the remembered model is unavailable.
        }
      }
      for (const option of secondaryConfigOptions(defaultConfigOptions())) {
        const current = session.configOptions?.find((entry) => entry.id === option.id);
        if (!current || current.currentValue === option.currentValue) continue;
        try {
          const result = await props.api.setConfig(session.id, option.id, option.currentValue);
          if (result.data) {
            session.configOptions = result.data;
            setSessions((prev) => prev.map((item) =>
              item.id === session.id ? { ...item, configOptions: result.data } : item));
          }
        } catch {
          // Keep the agent's default when a draft option is unavailable.
        }
      }
      return session;
    } catch (error) {
      showToast(formatError(error), true);
      return null;
    }
  }

  async function sendContent(content: PromptContent[], clearComposer = false): Promise<void> {
    if (content.length === 0 || currentBusy() || switchingAgent()) return;
    let id = currentID();
    if (!id) {
      const session = await createSession();
      id = session?.id ?? null;
    }
    if (!id) return;
    setError(null);
    setBusy(true);
    const localID = nextID('user');
    const updates = updatesBySession.get(id) ?? [];
    for (const block of content) {
      updates.push({ sessionUpdate: 'user_message_chunk', messageId: localID, content: block });
    }
    updatesBySession.set(id, updates);
    setItems(normalizeHistory(updates));
    try {
      await props.api.prompt(id, content);
      if (clearComposer) {
        setDraft('');
        setAttachments([]);
      }
    } catch (error) {
      setBusy(false);
      setError(formatError(error));
      showToast(formatError(error), true);
    }
  }

  async function send(): Promise<void> {
    if (attachmentBusy()) return;
    const text = draft().trim();
    const attached = attachments();
    if ((!text && attached.length === 0) || currentBusy() || switchingAgent()) return;
    const content: PromptContent[] = [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...attached.map((attachment) =>
        promptContentForAttachment(attachment, promptCapabilities().embeddedContext === true)),
    ];
    const bytes = new TextEncoder().encode(JSON.stringify({ sessionID: 'pending', content })).byteLength;
    if (bytes > 950_000) {
      showToast(t('agent.attachmentTooLarge'), true);
      return;
    }
    await sendContent(content, true);
  }

  function retry(): void {
    const lastUser = [...items()].reverse().find((item) => item.kind === 'user');
    if (!lastUser || lastUser.kind !== 'user') return;
    const content = lastUser.content.length > 0
      ? lastUser.content
      : [{ type: 'text' as const, text: lastUser.text }];
    void sendContent(content);
  }

  async function deleteSession(id: string): Promise<void> {
    setConfirmDelete(null);
    try {
      await props.api.removeSession(id);
      const next = sessions().filter((session) => session.id !== id);
      setSessions(next);
      if (currentID() === id) {
        setCurrentID(null);
        setItems([]);
        setPermissions([]);
        setForms([]);
        setBusy(false);
        props.onOpenPath?.('');
        props.onClosePath?.(`/${encodeURIComponent(id)}`);
      }
      showToast(t('agent.deleted'));
    } catch (error) {
      showToast(formatError(error), true);
    }
  }

  async function closeSession(id: string): Promise<void> {
    try {
      await props.api.closeSession(id);
      updatesBySession.delete(id);
      if (currentID() === id) {
        setCurrentID(null);
        setItems([]);
        setPermissions([]);
        setForms([]);
        setBusy(false);
        setModes(defaultModes());
        props.onOpenPath?.('');
        props.onClosePath?.(`/${encodeURIComponent(id)}`);
      }
      await refreshSessions();
      showToast(t('agent.sessionClosed'));
    } catch (error) {
      showToast(formatError(error), true);
    }
  }

  async function forkSession(id: string): Promise<void> {
    try {
      const session = await props.api.forkSession(id);
      setSessions((prev) => [session, ...prev.filter((item) => item.id !== session.id)]);
      const path = `/${encodeURIComponent(session.id)}`;
      if (props.onOpenPath) {
        props.onOpenPath(path, { title: sessionTitle(session) });
        void selectSession(session.id);
      } else {
        await selectSession(session.id);
      }
      showToast(t('agent.forked'));
    } catch (error) {
      showToast(formatError(error), true);
    }
  }

  async function replyForm(form: FormInfo, answer: Record<string, unknown>): Promise<void> {
    try {
      await props.api.replyForm(form.id, 'accept', answer);
      setForms((prev) => prev.filter((item) => item.id !== form.id));
    } catch (error) {
      showToast(formatError(error), true);
    }
  }

  async function cancelForm(form: FormInfo): Promise<void> {
    try {
      await props.api.replyForm(form.id, 'cancel');
      setForms((prev) => prev.filter((item) => item.id !== form.id));
    } catch (error) {
      showToast(formatError(error), true);
    }
  }

  async function declineForm(form: FormInfo): Promise<void> {
    try {
      await props.api.replyForm(form.id, 'decline');
      setForms((prev) => prev.filter((item) => item.id !== form.id));
    } catch (error) {
      showToast(formatError(error), true);
    }
  }

  async function interrupt(): Promise<void> {
    const id = currentID();
    if (!id) return;
    try {
      await props.api.interrupt(id);
      setBusy(false);
      setItems((prev) => prev.map((item) =>
        item.kind === 'assistant' ? { ...item, streaming: false } : item));
    } catch (error) {
      showToast(formatError(error), true);
    }
  }

  async function changeModel(model: Model): Promise<void> {
    setSelectedModel(model);
    storeModel(props.storageKey, model);
    const id = currentID();
    if (!id) return;
    try {
      const result = await props.api.setConfig(id, 'model', `${model.providerID}/${model.id}`);
      if (result.data) {
        setSessions((prev) => prev.map((item) =>
          item.id === id ? { ...item, configOptions: result.data } : item));
      }
    } catch (error) {
      showToast(formatError(error), true);
    }
  }

  async function changeMode(modeID: string): Promise<void> {
    const id = currentID();
    const current = id ? modes() : defaultModes();
    if (!current || current.currentModeId === modeID) return;
    if (!id) {
      setDefaultModes({ ...current, currentModeId: modeID });
      return;
    }
    setModes({ ...current, currentModeId: modeID });
    try {
      const result = await props.api.setMode(id, modeID);
      setModes(result.modes);
      setDefaultModes(result.modes);
      setSessions((prev) => prev.map((item) =>
        item.id === id ? { ...item, modes: result.modes } : item));
    } catch (error) {
      setModes(current);
      showToast(formatError(error), true);
    }
  }

  async function addAttachments(files: FileList | File[]): Promise<void> {
    if (attachmentBusy()) return;
    setAttachmentBusy(true);
    try {
      const caps = promptCapabilities();
      const current = attachments();
      const next: PromptAttachment[] = [];
      let total = current.reduce((sum, item) => sum + (item.data?.length ?? 0) + (item.text?.length ?? 0), 0);
      for (const file of [...files]) {
        if (current.length + next.length >= 6) {
          showToast(t('agent.attachmentLimit'), true);
          break;
        }
        const result = await prepareAttachment(file, caps);
        if (result.error) {
          showToast(t(`agent.attachment.${result.error}`), true);
          continue;
        }
        if (!result.attachment) continue;
        const size = (result.attachment.data?.length ?? 0) + (result.attachment.text?.length ?? 0);
        if (total + size > 900_000) {
          showToast(t('agent.attachmentTooLarge'), true);
          continue;
        }
        total += size;
        next.push(result.attachment);
      }
      if (next.length) setAttachments([...current, ...next]);
    } finally {
      setAttachmentBusy(false);
    }
  }

  function removeAttachment(id: string): void {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }

  async function changeConfig(configID: string, value: string | boolean): Promise<void> {
    if (configBusy()) return;
    const id = currentID();
    const target = id ?? draftSessionID();
    setConfigBusy(true);
    try {
      if (!target) {
        setDefaultConfigOptions((prev) => prev.map((option) =>
          option.id === configID ? { ...option, currentValue: value } : option));
        return;
      }
      const result = await props.api.setConfig(target, configID, value);
      const options = result.data ?? [];
      const nextModes = modeStateFromOptions(options);
      const nextModel = modelFromConfig(options, models());
      if (id) {
        setSessions((prev) => prev.map((session) => session.id === id
          ? { ...session, configOptions: options, modes: nextModes ?? session.modes }
          : session));
        setDefaultConfigOptions(options);
        if (nextModes) setModes(nextModes);
        if (nextModel) setSelectedModel(nextModel);
      } else {
        setDefaultConfigOptions(options);
        if (nextModes) setDefaultModes(nextModes);
        if (nextModel) setSelectedModel(nextModel);
      }
    } catch (error) {
      showToast(formatError(error), true);
    } finally {
      setConfigBusy(false);
    }
  }

  async function replyPermission(request: PermissionRequest, optionID: string): Promise<void> {
    try {
      await props.api.replyPermission(request.id, optionID);
      setPermissions((prev) => prev.filter((item) => item.id !== request.id));
    } catch (error) {
      showToast(formatError(error), true);
    }
  }

  function usageFromPrompt(usage: unknown): Usage | undefined {
    if (!usage || typeof usage !== 'object') return undefined;
    const value = usage as Record<string, any>;
    const input = Number(value.inputTokens ?? 0);
    const output = Number(value.outputTokens ?? 0);
    const reasoning = Number(value.thoughtTokens ?? 0);
    if (!input && !output && !reasoning) return undefined;
    return { tokens: { input, output, reasoning } };
  }

  function applySessionStateUpdate(sessionID: string, update: Record<string, any>): void {
    if (update.sessionUpdate === 'current_mode_update' && typeof update.currentModeId === 'string') {
      const currentModeId = update.currentModeId;
      setSessions((prev) => prev.map((session) => session.id === sessionID
        ? { ...session, modes: session.modes ? { ...session.modes, currentModeId } : session.modes }
        : session));
      if (sessionID === currentID()) {
        setModes((prev) => prev ? { ...prev, currentModeId } : prev);
      } else if (sessionID === draftSessionID()) {
        setDefaultModes((prev) => prev ? { ...prev, currentModeId } : prev);
      }
    }
    if (update.sessionUpdate === 'config_option_update' && Array.isArray(update.configOptions)) {
      const options = update.configOptions as ConfigOption[];
      const nextModes = modeStateFromOptions(options);
      setSessions((prev) => prev.map((session) => session.id === sessionID
        ? { ...session, configOptions: options, modes: nextModes ?? session.modes }
        : session));
      if (sessionID === currentID()) {
        if (nextModes) setModes(nextModes);
        const nextModel = modelFromConfig(options, models());
        if (nextModel) setSelectedModel(nextModel);
      } else if (sessionID === draftSessionID()) {
        setDefaultConfigOptions(options);
        if (nextModes) setDefaultModes(nextModes);
        const nextModel = modelFromConfig(options, models());
        if (nextModel) setSelectedModel(nextModel);
      }
    }
  }

  function handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'state':
        if (event.status === 'error') setError(event.message || t('agent.agentError'));
        if (event.status === 'closed' && !disposed) setError(event.message || t('agent.agentDisconnected'));
        break;
      case 'busy':
        if (event.sessionID !== currentID()) return;
        setBusy(event.busy);
        if (!event.busy) {
          setItems((prev) => prev.map((item) => item.kind === 'assistant' ? { ...item, streaming: false } : item));
        }
        break;
      case 'update': {
        const update = event.update as Record<string, any>;
        if (update.sessionUpdate === 'current_mode_update' || update.sessionUpdate === 'config_option_update') {
          applySessionStateUpdate(event.sessionID, update);
        }
        if (event.sessionID !== currentID()) return;
        const list = updatesBySession.get(event.sessionID) ?? [];
        list.push(event.update);
        updatesBySession.set(event.sessionID, list);
        setItems(normalizeHistory(list));
        if (update.sessionUpdate === 'available_commands_update') {
          setCommands((update.availableCommands ?? []) as Command[]);
        } else if (update.sessionUpdate === 'session_info_update') {
          void refreshSessions();
        }
        break;
      }
      case 'terminal_output':
        setTerminalOutputs((prev) => ({
          ...prev,
          [event.terminalID]: {
            output: event.output,
            truncated: event.truncated,
            ...(event.exitStatus ? { exitStatus: event.exitStatus } : {}),
          },
        }));
        break;
      case 'commands':
        setCommands(event.commands ?? []);
        break;
      case 'permission':
        if (event.request.sessionID !== currentID()) return;
        setPermissions((prev) => [...prev.filter((item) => item.id !== event.request.id), event.request]);
        break;
      case 'permission_replied':
        setPermissions((prev) => prev.filter((item) => item.id !== event.requestID));
        break;
      case 'form':
        if (event.form.sessionID !== currentID()) return;
        setForms((prev) => [...prev.filter((item) => item.id !== event.form.id), event.form]);
        break;
      case 'form_replied':
        if (event.sessionID !== currentID()) return;
        setForms((prev) => prev.filter((item) => item.id !== event.formID));
        break;
      case 'prompt_done': {
        if (event.sessionID === currentID()) {
          setBusy(false);
          const usage = usageFromPrompt(event.usage);
          setItems((prev) => {
            let last = -1;
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].kind === 'assistant') { last = i; break; }
            }
            return prev.map((item, index) =>
              item.kind === 'assistant'
                ? { ...item, streaming: false, ...(index === last && usage ? { usage } : {}) }
                : item);
          });
        }
        void refreshSessions();
        break;
      }
      case 'sessions_changed':
        void refreshSessions();
        break;
      default:
        break;
    }
  }

  function showToast(message: string, isError = false): void {
    setToast({ text: message, error: isError });
  }

  function copy(value: string): void {
    void copyText(value).then((ok) => showToast(ok ? t('agent.copied') : t('agent.copyFailed'), !ok));
  }

  function suggestion(text: string): void {
    setDraft(text);
  }

  return (
    <div class="op-app" data-theme={props.theme}>
      <div class="op-main">
        <Show
          when={ready()}
          fallback={<div class="op-loading"><Spinner size={18} /><span>{t('agent.starting')}</span></div>}
        >
          <Show when={!initError()} fallback={
            <div class="op-fatal">
              <div class="op-fatal-icon"><Icon name="alert" size={24} /></div>
              <h2>{t('agent.agentUnavailable')}</h2>
              <p>{initError()}</p>
              <p class="op-fatal-hint">
                {t('agent.fatal.installPrefix')} OpenCode
                (<code>opencode acp</code>) {t('agent.fatal.or')} Command Code
                (<code>command-code acp</code>). {t('agent.fatal.installSuffix')}
              </p>
              <Show when={runtimeAgents().length > 1}>
                <RuntimeAgentPicker
                  agents={runtimeAgents()}
                  value={selectedRuntime()}
                  disabled={switchingAgent()}
                  onChange={(id) => void changeRuntimeAgent(id)}
                  class="op-fatal-agent"
                />
              </Show>
            </div>
          }>
            <Show when={error()}>
              <div class="op-error-banner">
                <Icon name="alert" size={15} />
                <span>{error()}</span>
                <IconButton icon="x" title={t('agent.dismiss')} onClick={() => setError(null)} />
              </div>
            </Show>
            <Show when={showAuth()}>
              <div class="op-auth">
                <div class="op-auth-head">
                  <span class="op-auth-icon"><Icon name="shield" size={16} /></span>
                  <div class="op-auth-copy">
                    <strong>{t('agent.authRequired')}</strong>
                    <span>{t('agent.authDescription', { agent: agentName() })}</span>
                  </div>
                  <Show when={!authRequired()}>
                    <IconButton icon="x" title={t('agent.dismiss')} onClick={() => setAuthDismissed(true)} />
                  </Show>
                </div>
                <Show when={authMethods().length > 0} fallback={<div class="op-auth-empty">{t('agent.authFailed')}</div>}>
                  <div class="op-auth-actions">
                    <For each={authMethods()}>
                      {(method) => {
                        const terminal = method.type === 'terminal';
                        return (
                          <button
                            type="button"
                            class="op-btn primary"
                            disabled={authBusy() || terminal}
                            title={terminal ? t('agent.authTerminalUnsupported') : method.description || method.name}
                            onClick={() => void authenticate(method.id)}
                          >
                            <Show when={authBusy()} fallback={<Icon name="shield" size={13} />}>
                              <Spinner size={12} />
                            </Show>
                            <span>{method.name || t('agent.signIn')}</span>
                            <Show when={terminal}>
                              <span class="op-auth-hint">{t('agent.authTerminalUnsupported')}</span>
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
            <Show
              when={sessionReady() || routeMissing()}
              fallback={<div class="op-loading"><Spinner size={18} /><span>{t('agent.openingSession')}</span></div>}
            >
              <div class="op-chatbar">
                <span class="op-chatbar-title">{currentSession() ? sessionTitle(currentSession()) : t('agent.newChat')}</span>
                <button
                  type="button"
                  class="op-chatbar-sessions"
                  onClick={openResume}
                  title={t('agent.resumeSession')}
                  aria-label={t('agent.resumeSession')}
                >
                  <Icon name="list" size={15} />
                  <span>{t('agent.resume')}</span>
                </button>
                <Show when={runtimeAgents().length > 1}>
                  <RuntimeAgentPicker
                    agents={runtimeAgents()}
                    value={selectedRuntime()}
                    disabled={currentBusy() || switchingAgent()}
                    onChange={(id) => void changeRuntimeAgent(id)}
                  />
                </Show>
                <Show
                  when={switchingAgent()}
                  fallback={
                    <Show when={currentBusy()}>
                      <span class="op-chatbar-working"><Spinner size={11} /><span>{t('agent.working')}</span></span>
                    </Show>
                  }
                >
                  <span class="op-chatbar-working"><Spinner size={11} /><span>{t('agent.switching')}</span></span>
                </Show>
                <Show when={currentSession() && canCloseSession()}>
                  <IconButton
                    icon="x"
                    title={t('agent.closeSession')}
                    disabled={currentBusy() || switchingAgent()}
                    onClick={() => {
                      const session = currentSession();
                      if (session) void closeSession(session.id);
                    }}
                  />
                </Show>
              </div>
              <MessageList
                items={items()}
                busy={currentBusy()}
                agentName={agentName()}
                terminalOutputs={terminalOutputs()}
                onSuggestion={suggestion}
                onCopy={copy}
                onRetry={retry}
                onPermission={(request, optionID) => void replyPermission(request, optionID)}
                onForm={(form, answer) => void replyForm(form, answer)}
                onCancelForm={(form) => void cancelForm(form)}
              />
              <Show when={permissions().length > 0 || forms().length > 0}>
                <div class="op-pending">
                  <For each={permissions()}>
                    {(request) => (
                      <PermissionCard
                        request={request}
                        onReply={(decision) => void replyPermission(request, decision)}
                      />
                    )}
                  </For>
                  <For each={forms()}>
                    {(form) => (
                      <FormCard
                        form={form}
                        onReply={(answer) => void replyForm(form, answer)}
                        onDecline={() => void declineForm(form)}
                        onCancel={() => void cancelForm(form)}
                      />
                    )}
                  </For>
                </div>
              </Show>
              <Composer
                draft={draft()}
                busy={currentBusy()}
                agentName={agentName()}
                models={models()}
                providers={providers()}
                model={selectedModel()}
                modes={currentSession() ? modes() : defaultModes()}
                configOptions={currentSession()?.configOptions ?? defaultConfigOptions()}
                configBusy={configBusy()}
                attachments={attachments()}
                attachmentBusy={attachmentBusy()}
                commands={commands()}
                disabled={!ready() || switchingAgent() || authBlocked()}
                onDraft={setDraft}
                onSend={() => void send()}
                onStop={() => void interrupt()}
                onModel={(model) => void changeModel(model)}
                onMode={(modeID) => void changeMode(modeID)}
                onConfig={(configID, value) => void changeConfig(configID, value)}
                onAttach={(files) => void addAttachments(files)}
                onRemoveAttachment={removeAttachment}
                onCommand={(command) => setDraft(`/${command.name} `)}
                onResume={openResume}
              />
            </Show>
          </Show>
        </Show>
      </div>
      <Show when={skillsOpen()}>
        <SkillsPanel
          api={props.api}
          onClose={() => setSkillsOpen(false)}
          onToast={showToast}
        />
      </Show>
      <Show when={mcpOpen()}>
        <McpPanel
          servers={mcpServers()}
          saving={mcpSaving()}
          error={mcpError()}
          capabilities={capabilities() ? mcpCapabilities() : undefined}
          onSave={(servers) => void saveMcp(servers)}
          onClose={() => setMcpOpen(false)}
        />
      </Show>
      <Show when={promptOpen()}>
        <SystemPromptPanel
          text={promptText()}
          supported={capabilities() ? Boolean((capabilities()?.sessionCapabilities as Record<string, unknown> | undefined)?.systemPrompt) : true}
          saving={promptSaving()}
          error={promptError()}
          onSave={(text) => void saveSystemPrompt(text)}
          onClose={() => setPromptOpen(false)}
        />
      </Show>
      <Show when={resumeOpen()}>
        <ResumePicker
          agentName={agentName()}
          sessions={sessions()}
          currentID={currentID()}
          onOpen={(session) => {
            setResumeOpen(false);
            openSession(session);
          }}
          onClose={() => setResumeOpen(false)}
        />
      </Show>
      <Show when={confirmDelete()}>
        {(id) => (
          <ConfirmDialog
            title={t('agent.deleteTitle')}
            message={t('agent.deleteMessage')}
            confirm={t('agent.delete')}
            onConfirm={() => void deleteSession(id())}
            onCancel={() => setConfirmDelete(null)}
          />
        )}
      </Show>
      <Show when={toast()}>
        <div class={`op-toast ${toast()?.error ? 'error' : ''}`}>{toast()?.text}</div>
      </Show>
    </div>
  );
}

export function mount(el: HTMLElement, props: FeatureUiProps): FeatureUiHandle {
  const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
  shadow.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = css;
  const container = document.createElement('div');
  container.className = 'op-root-host';
  shadow.append(style, container);

  const [theme, setTheme] = createSignal(props.theme);
  const [lang, setLang] = createSignal(props.lang);
  const [path, setPath] = createSignal(props.path);
  const api = createApi(props.base);
  const storageKey = agentModelStorageKey(props.base);
  const runtimeStorageKey = agentRuntimeStorageKey(props.base);
  const mcpKey = mcpStorageKey(props.base);
  const promptKey = systemPromptStorageKey(props.base);

  const dispose = render(() => (
    <App
      api={api}
      storageKey={storageKey}
      runtimeStorageKey={runtimeStorageKey}
      mcpStorageKey={mcpKey}
      systemPromptStorageKey={promptKey}
      theme={theme()}
      lang={lang()}
      path={path()}
      onTabs={props.onTabs}
      onToolbar={props.onToolbar}
      onOpenPath={props.onOpenPath}
      onClosePath={props.onClosePath}
      onUpdateTab={props.onUpdateTab}
    />
  ), container);

  return {
    dispose() {
      dispose();
      shadow.innerHTML = '';
    },
    update(patch) {
      if (patch.theme !== undefined) setTheme(patch.theme);
      if (patch.lang !== undefined) setLang(patch.lang);
      if (patch.path !== undefined) setPath(patch.path);
    },
  };
}
