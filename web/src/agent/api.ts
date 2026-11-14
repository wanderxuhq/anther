// web/src/agent/api.ts
// Browser client for the built-in ACP agent bridge.
export type ConfigOptionChoice = {
  value: string;
  name: string;
  description?: string | null;
};

export type ConfigOptionGroup = {
  group: string;
  name: string;
  options: ConfigOptionChoice[];
};

export type ConfigOption = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  type: 'select' | 'boolean';
  currentValue: string | boolean;
  options?: Array<ConfigOptionChoice | ConfigOptionGroup>;
};

export type Model = {
  id: string;
  providerID: string;
  name?: string;
  enabled?: boolean;
  type?: string;
  cost?: Array<{ input: number; output: number }>;
};

export type Provider = { id: string; name: string; activation?: string };
export type AgentMode = {
  id: string;
  name: string;
  description?: string;
};
export type AgentModeState = {
  currentModeId: string;
  availableModes: AgentMode[];
};
export type Command = { name: string; description?: string };

export type Session = {
  id: string;
  title?: string;
  time?: { created: number; updated: number };
  configOptions?: ConfigOption[];
  modes?: AgentModeState;
};

export type DiscoveredAgent = {
  id: string;
  name: string;
  selected: boolean;
};

export type AgentDiscovery = {
  agents: DiscoveredAgent[];
  selectedAgent?: string;
};

export type AuthMethod = {
  id: string;
  name: string;
  description?: string | null;
  type?: 'agent' | 'terminal';
  args?: string[];
  env?: Record<string, string>;
};

export type McpHeader = { name: string; value: string };

export type McpServer =
  | { type: 'stdio'; name: string; command: string; args: string[]; env: McpHeader[] }
  | { type: 'http' | 'sse'; name: string; url: string; headers: McpHeader[] };

export type Status = {
  ready: boolean;
  starting?: boolean;
  error?: string;
  agent?: { name: string; title?: string; version: string };
  capabilities?: Record<string, unknown>;
  defaultModel?: { providerID: string; id: string } | null;
  availableAgents?: DiscoveredAgent[];
  selectedAgent?: string;
  modes?: AgentModeState;
  configOptions?: ConfigOption[];
  bootstrapSessionID?: string;
  authMethods?: AuthMethod[];
  authenticated?: boolean;
  authRequired?: boolean;
};

export type ModelList = { data: Model[] };
export type ProviderList = { data: Provider[] };
export type CommandList = { data: Command[] };
export type SessionList = { data: Session[] };
export type MessageList = { data: unknown[]; configOptions?: ConfigOption[]; modes?: AgentModeState };

export type SkillTarget = {
  id: string;
  name: string;
  dir: string;
  universal: boolean;
};

export type SkillDiagnostic = {
  code: string;
  message: string;
  fix?: string;
};

export type SkillSource = {
  input: string;
  type: string;
  url: string;
  ref?: string;
  commit?: string;
  subpath?: string;
};

export type SkillPreviewItem = {
  name: string;
  description: string;
  path?: string;
  duplicates?: string[];
  pluginName?: string;
  metadata?: Record<string, unknown>;
};

export type SkillPreview = {
  token: string;
  source: SkillSource;
  skills: SkillPreviewItem[];
  warnings: SkillDiagnostic[];
};

export type InstalledSkill = {
  name: string;
  description: string;
  scope: 'project';
  path: string;
  agents: string[];
  source?: string;
};

export type SkillList = {
  skills: InstalledSkill[];
  targets: SkillTarget[];
  agents: Record<string, string>;
};

export type SkillInstallTarget = {
  skill: string;
  agent: string;
  scope: 'project';
  mode: 'symlink' | 'copy';
  path: string;
  canonicalPath?: string;
};

export type SkillInstallResult = {
  source: SkillSource;
  installed: SkillInstallTarget[];
  skipped: Array<{ skill: string; agent: string; reason: 'missing-agent-directory' }>;
  failed: Array<{ skill: string; agent: string; code: string; message: string }>;
  warnings: SkillDiagnostic[];
};

export type SkillRemoveResult = {
  removed: string[];
  notFound: string[];
  failed: Array<{ skill: string; code: string; message: string }>;
  warnings: SkillDiagnostic[];
};

export type TerminalExit = {
  exitCode: number | null;
  signal: string | null;
};

export type TerminalOutput = {
  output: string;
  truncated: boolean;
  exitStatus?: TerminalExit;
};

export type PromptContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string; uri?: string }
  | { type: 'audio'; mimeType: string; data: string }
  | {
      type: 'resource_link';
      uri: string;
      name: string;
      mimeType?: string;
      title?: string;
      description?: string;
      size?: number;
    }
  | {
      type: 'resource';
      resource: { uri: string; mimeType?: string; text?: string; blob?: string };
    };

export type PermissionRequest = {
  id: string;
  sessionID: string;
  title: string;
  kind?: string;
  message?: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
};

export type FormField = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  type: string;
  options?: Array<{ value: string; label: string; description?: string }>;
  minimum?: number | string;
  maximum?: number | string;
  minLength?: number;
  maxLength?: number;
  format?: string;
  url?: string;
  placeholder?: string;
  default?: unknown;
  when?: Array<{ key: string; op: string; value: unknown }>;
};

export type FormInfo = {
  id: string;
  sessionID: string;
  title: string;
  message?: string;
  toolCallID?: string;
  fields: FormField[];
  metadata?: Record<string, unknown>;
  state?: { status: string; answer?: Record<string, unknown>; message?: string };
};

export type FormAction = 'accept' | 'decline' | 'cancel';

export type AgentEvent =
  | { type: 'update'; sessionID: string; update: Record<string, any>; created: number }
  | { type: 'commands'; commands: Command[] }
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'permission_replied'; requestID: string; sessionID: string }
  | { type: 'form'; form: FormInfo }
  | { type: 'form_replied'; formID: string; sessionID: string }
  | { type: 'busy'; sessionID: string; busy: boolean }
  | { type: 'prompt_done'; sessionID: string; stopReason?: string; usage?: unknown }
  | { type: 'terminal_output'; sessionID: string; terminalID: string; output: string; truncated: boolean; exitStatus?: TerminalExit }
  | { type: 'sessions_changed' }
  | { type: 'state'; status: 'starting' | 'ready' | 'closed' | 'error'; message?: string };

export function createApi(base: string) {
  const root = `${base}/_/agent/api`;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${root}${path}`, {
      ...init,
      headers: init?.body
        ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
        : init?.headers,
    });
    const text = await res.text();
    let data: any;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      const message = data && typeof data === 'object' && typeof data.error === 'string'
        ? data.error
        : res.statusText;
      throw new Error(message || `HTTP ${res.status}`);
    }
    return data as T;
  }

  const post = <T>(path: string, body?: unknown) => request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    status: () => request<Status>('/status'),
    discovery: () => request<AgentDiscovery>('/discovery'),
    selectAgent: (agentID: string) => post<AgentDiscovery>('/select-agent', { agentID }),
    mcp: () => request<{ data: McpServer[] }>('/mcp'),
    setMcp: (servers: McpServer[]) => request<{ data: McpServer[] }>('/mcp', {
      method: 'PUT',
      body: JSON.stringify({ servers }),
    }),
    authenticate: (methodID: string) => post<Status>('/auth', { methodID }),
    logout: () => post<Status>('/logout'),
    models: () => request<ModelList>('/models'),
    providers: () => request<ProviderList>('/providers'),
    commands: () => request<CommandList>('/commands'),
    sessions: () => request<SessionList>('/sessions'),
    session: (sessionID: string) => request<Session>(`/session?sessionID=${encodeURIComponent(sessionID)}`),
    messages: (sessionID: string) => request<MessageList>(`/messages?sessionID=${encodeURIComponent(sessionID)}`),
    createSession: () => post<Session>('/sessions'),
    removeSession: (sessionID: string) => post<void>('/sessions/remove', { sessionID }),
    forkSession: (sessionID: string) => post<Session>('/sessions/fork', { sessionID }),
    setConfig: (sessionID: string, configID: string, value: string | boolean) =>
      post<{ data: ConfigOption[] }>('/sessions/config', { sessionID, configID, value }),
    setMode: (sessionID: string, modeID: string) =>
      post<{ modes: AgentModeState }>('/sessions/mode', { sessionID, modeID }),
    prompt: (sessionID: string, content: PromptContent[]) =>
      post<{ accepted: boolean }>('/prompt', { sessionID, content }),
    interrupt: (sessionID: string) => post<unknown>('/interrupt', { sessionID }),
    permissions: (sessionID: string) =>
      request<{ data: PermissionRequest[] }>(`/permissions?sessionID=${encodeURIComponent(sessionID)}`),
    replyPermission: (requestID: string, optionId: string) =>
      post<void>('/permission/reply', { requestID, optionId }),
    forms: (sessionID: string) =>
      request<{ data: FormInfo[] }>(`/forms?sessionID=${encodeURIComponent(sessionID)}`),
    replyForm: (formID: string, action: FormAction, content?: Record<string, unknown>) =>
      post<void>('/forms/reply', { formID, action, content }),
    skills: () => request<SkillList>('/skills'),
    skillTargets: () => request<{ data: SkillTarget[] }>('/skills/targets'),
    resolveSkills: (source: string, options: { ref?: string } = {}) =>
      post<SkillPreview>('/skills/resolve', { source, ...options }),
    installSkills: (token: string, skills: string[], agents: string[]) =>
      post<SkillInstallResult>('/skills/install', { token, skills, agents }),
    removeSkill: (name: string, agents?: string[]) =>
      post<SkillRemoveResult>('/skills/remove', { name, ...(agents?.length ? { agents } : {}) }),
    disposeSkills: (token: string) => post<{ disposed: boolean }>('/skills/dispose', { token }),
    eventsUrl: () => `${root}/events`,
  };
}

export type Api = ReturnType<typeof createApi>;
