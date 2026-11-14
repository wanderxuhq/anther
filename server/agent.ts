// server/agent.ts
// Built-in ACP host: one native ACP agent subprocess per workspace.
// The agent owns provider config, authentication, tools and session storage;
// anther only speaks ACP and maps the events into its UI.
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';
import { discoverAgents, type DiscoveredAgent } from './agent-profiles.ts';
import { formFromElicitation, formResponse, type AgentForm } from './agent-forms.ts';
import { collectSessionPages } from './agent-session-list.ts';
import { AgentFileSystem } from './agent-fs.ts';
import { filterMcpServers, mcpServersEqual } from './mcp.ts';
import { acpSystemPrompt } from './system-prompt.ts';
import { AcpTerminalManager } from './agent-terminal.ts';
import { FileStore } from './files.ts';

export type AgentEvent =
  | { type: 'update'; sessionID: string; update: acp.SessionUpdate; created: number }
  | { type: 'commands'; commands: acp.AvailableCommand[] }
  | { type: 'permission'; request: AgentPermission }
  | { type: 'permission_replied'; requestID: string; sessionID: string }
  | { type: 'form'; form: AgentForm }
  | { type: 'form_replied'; formID: string; sessionID: string }
  | { type: 'busy'; sessionID: string; busy: boolean }
  | { type: 'prompt_done'; sessionID: string; stopReason?: string; usage?: unknown }
  | { type: 'terminal_output'; sessionID: string; terminalID: string; output: string; truncated: boolean; exitStatus?: { exitCode: number | null; signal: string | null } }
  | { type: 'sessions_changed' }
  | { type: 'state'; status: 'starting' | 'ready' | 'closed' | 'error'; message?: string };

export type AgentModel = {
  id: string;
  providerID: string;
  name?: string;
  enabled?: boolean;
  type?: string;
};

export type AgentPermission = {
  id: string;
  sessionID: string;
  title: string;
  kind?: string;
  message?: string;
  options: acp.PermissionOption[];
};

export type AgentStatus = {
  ready: boolean;
  starting?: boolean;
  agent?: acp.Implementation;
  capabilities?: acp.AgentCapabilities;
  defaultModel?: { providerID: string; id: string } | null;
  availableAgents?: AgentOption[];
  selectedAgent?: string;
  modes?: AgentModeState;
  configOptions?: acp.SessionConfigOption[];
  bootstrapSessionID?: string;
  authMethods?: acp.AuthMethod[];
  authenticated?: boolean;
  authRequired?: boolean;
  error?: string;
};

export type AgentOption = {
  id: string;
  name: string;
  selected: boolean;
};

export type AgentDiscovery = {
  agents: AgentOption[];
  selectedAgent?: string;
};

export type AgentMode = {
  id: string;
  name: string;
  description?: string;
};

export type AgentModeState = {
  currentModeId: string;
  availableModes: AgentMode[];
};

type StoredModes = {
  state: AgentModeState;
  configID?: string;
};

type PendingPermission = {
  params: acp.RequestPermissionRequest;
  resolve: (response: acp.RequestPermissionResponse) => void;
};

type PendingForm = {
  form: AgentForm;
  resolve: (response: acp.CreateElicitationResponse) => void;
};

type Bootstrap = {
  sessionId: string;
  configOptions: acp.SessionConfigOption[];
  modes?: AgentModeState;
};

const START_TIMEOUT_MS = 60_000;

export class AgentRuntime {
  private child?: ChildProcess;
  private context?: acp.ClientContext;
  private init?: acp.InitializeResponse;
  private readyPromise?: Promise<void>;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private closedResolve?: () => void;
  private closedPromise?: Promise<void>;
  private error?: string;
  private disposed = false;
  private boot?: Bootstrap;
  private bootPending?: Promise<Bootstrap>;
  private bootEpoch = 0;
  private bootstrapUsed = false;
  private readonly retiredBootstraps = new Set<string>();
  private readonly sessionMcp = new Map<string, acp.McpServer[]>();
  private readonly sessionPrompt = new Map<string, acp.SystemPrompt | null>();
  private readonly attached = new Set<string>();
  private readonly historyKnown = new Set<string>();
  private readonly attaching = new Map<string, Promise<void>>();
  private readonly sessionEpoch = new Map<string, number>();
  private generation = 0;
  private commands: acp.AvailableCommand[] = [];
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly pending = new Map<string, PendingPermission>();
  private readonly pendingForms = new Map<string, PendingForm>();
  private readonly titles = new Map<string, string>();
  private readonly configs = new Map<string, acp.SessionConfigOption[]>();
  private readonly modeStates = new Map<string, StoredModes>();
  private readonly busy = new Set<string>();
  private permissionSeq = 0;
  private formSeq = 0;
  private readonly replays = new Map<string, acp.SessionUpdate[]>();
  private readonly history = new Map<string, acp.SessionUpdate[]>();
  private startTimer?: ReturnType<typeof setTimeout>;
  private readonly agentFiles: AgentFileSystem;
  private readonly acpTerminals: AcpTerminalManager;
  private authenticated = false;
  private authRequired = false;

  constructor(
    private readonly dir: string,
    private readonly discovered: DiscoveredAgent,
    private readonly files: FileStore,
    private readonly mcpServers: () => acp.McpServer[] = () => [],
    private readonly systemPrompt: () => string | undefined = () => undefined,
  ) {
    this.agentFiles = new AgentFileSystem(dir, files);
    this.acpTerminals = new AcpTerminalManager(dir, (event) => this.emit(event));
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* 客户端断开不应影响 agent */ }
    }
  }


  async start(): Promise<void> {
    if (this.disposed) throw new Error('agent host is disposed');
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.launch();
    return this.readyPromise;
  }

  private async launch(): Promise<void> {
    const discovered = this.discovered;
    const executable = discovered.executable;
    const args = discovered.profile.args;
    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.emit({ type: 'state', status: 'starting' });
      let child: ChildProcess;
      try {
        child = spawn(executable, args, {
          cwd: this.dir,
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: process.platform === 'win32',
        });
      } catch (error) {
        this.fail(error);
        return;
      }
      this.child = child;
      let resolveClosed!: () => void;
      const closed = new Promise<void>((done) => {
        resolveClosed = done;
        this.closedResolve = done;
      });
      this.closedPromise = closed;

      child.on('error', (error) => {
        if (this.child === child) this.fail(error);
      });
      child.on('exit', (code, signal) => {
        const message = `ACP agent exited (${signal ?? code ?? 'unknown'})`;
        if (this.child === child) {
          this.cancelForms();
          this.cancelPermissions();
          void this.acpTerminals.close();
          this.init = undefined;
          this.authRequired = false;
          this.authenticated = false;
          this.boot = undefined;
          this.bootstrapUsed = false;
          this.attached.clear();
          this.historyKnown.clear();
          this.attaching.clear();
          this.sessionEpoch.clear();
          this.generation += 1;
          if (!this.disposed) {
            this.emit({ type: 'state', status: 'closed', message });
            if (this.error === undefined) this.error = message;
            this.readyPromise = undefined;
            this.context = undefined;
            this.child = undefined;
          }
        }
        reject(new Error(message));
        resolveClosed();
      });
      child.stderr?.on('data', (chunk) => {
        // Agent stderr is log output; keep it out of the ACP stream.
        const text = String(chunk).trim();
        if (text) console.error(`[agent] ${text}`);
      });
      if (!child.stdin || !child.stdout) {
        this.fail(new Error('ACP agent did not expose stdio'));
        return;
      }

      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const app = acp.client({ name: 'anther' })
        .onRequest(acp.methods.client.session.requestPermission, (ctx) => this.child === child
          ? this.requestPermission(ctx.params)
          : Promise.resolve({ outcome: { outcome: 'cancelled' } }))
        .onRequest(acp.methods.client.elicitation.create, (ctx) => this.child === child
          ? this.requestForm(ctx.params)
          : Promise.resolve({ action: 'decline' }))
        .onRequest(acp.methods.client.fs.readTextFile, (ctx) => this.child === child
          ? this.agentFiles.readTextFile(ctx.params)
          : Promise.reject(RequestError.internalError(undefined, 'agent connection closed')))
        .onRequest(acp.methods.client.fs.writeTextFile, (ctx) => this.child === child
          ? this.agentFiles.writeTextFile(ctx.params)
          : Promise.reject(RequestError.internalError(undefined, 'agent connection closed')))
        .onRequest(acp.methods.client.terminal.create, (ctx) => this.child === child
          ? this.acpTerminals.create(ctx.params)
          : Promise.reject(RequestError.internalError(undefined, 'agent connection closed')))
        .onRequest(acp.methods.client.terminal.output, (ctx) => this.child === child
          ? this.acpTerminals.output(ctx.params.sessionId, ctx.params.terminalId)
          : Promise.reject(RequestError.internalError(undefined, 'agent connection closed')))
        .onRequest(acp.methods.client.terminal.waitForExit, (ctx) => this.child === child
          ? this.acpTerminals.waitForExit(ctx.params.sessionId, ctx.params.terminalId)
          : Promise.reject(RequestError.internalError(undefined, 'agent connection closed')))
        .onRequest(acp.methods.client.terminal.kill, (ctx) => this.child === child
          ? this.acpTerminals.kill(ctx.params.sessionId, ctx.params.terminalId)
          : Promise.reject(RequestError.internalError(undefined, 'agent connection closed')))
        .onRequest(acp.methods.client.terminal.release, (ctx) => this.child === child
          ? this.acpTerminals.release(ctx.params.sessionId, ctx.params.terminalId)
          : Promise.reject(RequestError.internalError(undefined, 'agent connection closed')))
        .onNotification(acp.methods.client.session.update, (ctx) => {
          if (this.child === child) this.onUpdate(ctx.params);
        })
        .onNotification(acp.methods.client.elicitation.complete, () => {
          // URL completion is informational; the UI already dismissed the
          // elicitation when the user consented to open the link.
        });

      this.startTimer = setTimeout(() => {
        this.fail(new Error('ACP agent did not initialize in time'));
        child.kill();
      }, START_TIMEOUT_MS);

      void app.connectWith(stream, async (ctx) => {
        this.context = ctx;
        const init = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
            session: {
              configOptions: { boolean: {} },
              notices: {},
              compaction: {},
            },
            elicitation: { form: {}, url: {} },
          },
          clientInfo: { name: 'anther', version: '1' },
        });
        this.init = init;
        this.authRequired = false;
        this.clearStartTimer();
        this.error = undefined;
        this.emit({ type: 'state', status: 'ready' });
        this.readyResolve?.();
        await closed;
      }).catch((error) => {
        if (this.child === child) this.fail(error);
      });
    });
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.error = message;
    this.clearStartTimer();
    this.emit({ type: 'state', status: 'error', message });
    this.readyReject?.(new Error(message));
  }

  private clearStartTimer(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = undefined;
  }

  async status(): Promise<AgentStatus> {
    try {
      await this.start();
      let boot: Bootstrap | undefined;
      try {
        boot = await this.ensureBootstrap();
      } catch (error) {
        if (!this.isAuthRequired(error)) throw error;
        this.authRequired = true;
        this.authenticated = false;
      }
      return {
        ready: true,
        agent: this.init?.agentInfo ?? undefined,
        capabilities: this.init?.agentCapabilities,
        defaultModel: this.defaultModel(boot?.configOptions),
        modes: boot?.modes,
        configOptions: boot?.configOptions ?? [],
        bootstrapSessionID: this.bootstrapUsed ? undefined : boot?.sessionId,
        authMethods: this.init?.authMethods ?? [],
        authenticated: this.authenticated,
        authRequired: this.authRequired,
      };
    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error.message : String(error),
        authMethods: this.init?.authMethods ?? [],
        authenticated: this.authenticated,
        authRequired: this.authRequired,
      };
    }
  }

  private async ensure(): Promise<acp.ClientContext> {
    await this.start();
    if (!this.context) throw new Error(this.error || 'ACP agent is not ready');
    return this.context;
  }

  private sessionMcpServers(): acp.McpServer[] {
    const capabilities = this.init?.agentCapabilities?.mcpCapabilities as
      | { http?: boolean; sse?: boolean }
      | undefined;
    return filterMcpServers(this.mcpServers(), capabilities);
  }

  private sessionSystemPrompt(): acp.SystemPrompt | undefined {
    const capabilities = this.init?.agentCapabilities?.sessionCapabilities as
      | acp.SessionCapabilities
      | undefined;
    return acpSystemPrompt(this.systemPrompt(), Boolean(capabilities?.systemPrompt));
  }

  invalidateBootstrap(): void {
    if (this.bootstrapUsed) return;
    this.bootEpoch += 1;
    const boot = this.boot;
    this.boot = undefined;
    if (boot) this.retireBootstrap(boot.sessionId);
  }

  private async ensureBootstrap(): Promise<Bootstrap> {
    for (;;) {
      if (this.boot) return this.boot;
      if (!this.bootPending) {
        const epoch = this.bootEpoch;
        const pending = this.createBootstrap()
          .then((bootstrap) => {
            if (epoch === this.bootEpoch && !this.disposed) {
              this.boot = bootstrap;
            } else {
              this.retireBootstrap(bootstrap.sessionId);
            }
            return bootstrap;
          })
          .finally(() => {
            if (this.bootPending === pending) this.bootPending = undefined;
          });
        this.bootPending = pending;
      }
      await this.bootPending;
    }
  }

  private retireBootstrap(sessionID: string): void {
    this.configs.delete(sessionID);
    this.modeStates.delete(sessionID);
    this.titles.delete(sessionID);
    this.history.delete(sessionID);
    this.sessionMcp.delete(sessionID);
    this.sessionPrompt.delete(sessionID);
    this.attached.delete(sessionID);
    this.historyKnown.delete(sessionID);
    this.attaching.delete(sessionID);
    this.bumpSession(sessionID);
    if (this.boot?.sessionId === sessionID) this.boot = undefined;
    if (this.disposed) return;
    this.retiredBootstraps.add(sessionID);
    void this.deleteSession(sessionID);
  }

  private bumpSession(sessionID: string): void {
    this.sessionEpoch.set(sessionID, (this.sessionEpoch.get(sessionID) ?? 0) + 1);
  }

  private async deleteSession(sessionID: string): Promise<void> {
    const capabilities = this.init?.agentCapabilities?.sessionCapabilities as
      | acp.SessionCapabilities
      | undefined;
    const ctx = this.context;
    if (!capabilities?.delete || !ctx) return;
    try {
      await ctx.request(acp.methods.agent.session.delete, { sessionId: sessionID });
      this.retiredBootstraps.delete(sessionID);
    } catch {
      // Keep hiding the retired bootstrap for the rest of this process.
    }
  }

  private async createBootstrap(): Promise<Bootstrap> {
    const ctx = await this.ensure();
    const mcpServers = this.sessionMcpServers();
    const systemPrompt = this.sessionSystemPrompt();
    const result = await ctx.request(acp.methods.agent.session.new, {
      cwd: this.dir,
      mcpServers,
      ...(systemPrompt ? { systemPrompt } : {}),
    });
    const configOptions = result.configOptions ?? [];
    const modes = modeStateFrom(result.modes, configOptions);
    this.authRequired = false;
    this.authenticated = true;
    if (result.sessionId) {
      this.configs.set(result.sessionId, configOptions);
      this.history.set(result.sessionId, []);
      this.attached.add(result.sessionId);
      this.historyKnown.add(result.sessionId);
      this.sessionMcp.set(result.sessionId, mcpServers);
      this.sessionPrompt.set(result.sessionId, systemPrompt ?? null);
      if (modes) this.modeStates.set(result.sessionId, modes);
    }
    return { sessionId: result.sessionId, configOptions, modes: modes?.state };
  }

  private defaultModel(
    options: acp.SessionConfigOption[] = this.boot?.configOptions ?? [],
  ): { providerID: string; id: string } | null {
    const model = this.modelOption(options);
    if (!model || typeof model.currentValue !== 'string') return null;
    return splitModel(model.currentValue);
  }

  private modelOption(options: acp.SessionConfigOption[]): acp.SessionConfigOption | undefined {
    return options.find((option) => option.id === 'model' || option.category === 'model');
  }

  private models(): AgentModel[] {
    const option = this.modelOption(this.boot?.configOptions ?? []);
    if (!option || !('options' in option) || !option.options) return [];
    const entries = option.options.flatMap((entry) => 'options' in entry ? entry.options : [entry]);
    return entries.map((entry) => {
      const model = splitModel(entry.value);
      return {
        id: model.id,
        providerID: model.providerID,
        name: entry.name,
        enabled: true,
        type: 'chat',
      };
    });
  }

  async modelsResponse(): Promise<AgentModel[]> {
    await this.status();
    return this.models();
  }

  async providers(): Promise<Array<{ id: string; name: string; activation: string }>> {
    const models = await this.modelsResponse();
    return [...new Set(models.map((model) => model.providerID))]
      .map((id) => ({ id, name: id, activation: 'enabled' }));
  }

  async commandsResponse(): Promise<acp.AvailableCommand[]> {
    await this.start();
    return this.commands;
  }

  async listSessions(): Promise<Array<{ id: string; title: string; time: { created: number; updated: number }; configOptions: acp.SessionConfigOption[]; modes?: AgentModeState }>> {
    await this.start();
    const ctx = await this.ensure();
    const capabilities = this.init?.agentCapabilities?.sessionCapabilities as Record<string, unknown> | undefined;
    let list: acp.SessionInfo[] = [];
    if (capabilities?.list) {
      try {
        list = await collectSessionPages((cursor) =>
          ctx.request(acp.methods.agent.session.list, {
            cwd: this.dir,
            ...(cursor ? { cursor } : {}),
          }));
      } catch {
        list = [];
      }
    }
    let boot: Bootstrap | undefined;
    try {
      boot = await this.ensureBootstrap();
    } catch (error) {
      if (!this.isAuthRequired(error)) throw error;
      this.authRequired = true;
      this.authenticated = false;
      return [];
    }
    // The bootstrap session exists to obtain model/mode config. Keep it out of
    // the UI until the user sends the first message. Retired bootstraps are
    // hidden too, even when the agent cannot delete them.
    const hideBoot = !this.bootstrapUsed;
    const sessions = list
      .filter((session) => !this.retiredBootstraps.has(session.sessionId))
      .filter((session) => !(hideBoot && session.sessionId === boot?.sessionId))
      .map((session) => {
        const parsed = session.updatedAt ? Date.parse(session.updatedAt) : NaN;
        const updated = Number.isFinite(parsed) ? parsed : Date.now();
        return {
          id: session.sessionId,
          title: this.titles.get(session.sessionId) ?? session.title ?? 'New chat',
          time: { created: updated, updated },
          configOptions: this.configs.get(session.sessionId) ?? [],
          modes: this.modeStates.get(session.sessionId)?.state,
        };
      });
    if (!hideBoot && boot && !sessions.some((session) => session.id === boot.sessionId)) {
      sessions.unshift({
        id: boot.sessionId,
        title: this.titles.get(boot.sessionId) ?? 'New chat',
        time: { created: Date.now(), updated: Date.now() },
        configOptions: boot.configOptions,
        modes: boot.modes,
      });
    }
    return sessions;
  }

  async session(id: string): Promise<{ id: string; title: string; configOptions: acp.SessionConfigOption[]; modes?: AgentModeState }> {
    // Loading is the only ACP operation that returns both history and config.
    // Use the same path as messages so a later history load never misses a
    // replay because the session was already attached.
    const { configOptions, modes } = await this.messages(id);
    return {
      id,
      title: this.titles.get(id) ?? 'New chat',
      configOptions,
      modes,
    };
  }

  async createSession(): Promise<{ id: string; title: string; time: { created: number; updated: number }; configOptions: acp.SessionConfigOption[]; modes?: AgentModeState }> {
    await this.start();
    const boot = await this.ensureBootstrap();
    if (!this.bootstrapUsed) {
      this.bootstrapUsed = true;
      return {
        id: boot.sessionId,
        title: this.titles.get(boot.sessionId) ?? 'New chat',
        time: { created: Date.now(), updated: Date.now() },
        configOptions: boot.configOptions,
        modes: boot.modes,
      };
    }
    const ctx = await this.ensure();
    const mcpServers = this.sessionMcpServers();
    const systemPrompt = this.sessionSystemPrompt();
    const result = await ctx.request(acp.methods.agent.session.new, {
      cwd: this.dir,
      mcpServers,
      ...(systemPrompt ? { systemPrompt } : {}),
    });
    const configOptions = result.configOptions ?? [];
    const modes = modeStateFrom(result.modes, configOptions);
    this.configs.set(result.sessionId, configOptions);
    this.history.set(result.sessionId, []);
    this.attached.add(result.sessionId);
    this.historyKnown.add(result.sessionId);
    this.sessionMcp.set(result.sessionId, mcpServers);
    this.sessionPrompt.set(result.sessionId, systemPrompt ?? null);
    if (modes) this.modeStates.set(result.sessionId, modes);
    return {
      id: result.sessionId,
      title: 'New chat',
      time: { created: Date.now(), updated: Date.now() },
      configOptions,
      modes: modes?.state,
    };
  }

  private sessionView(id: string): {
    updates: acp.SessionUpdate[];
    configOptions: acp.SessionConfigOption[];
    modes?: AgentModeState;
  } {
    return {
      updates: this.history.get(id) ?? [],
      configOptions: this.configs.get(id) ?? [],
      modes: this.modeStates.get(id)?.state,
    };
  }

  async messages(id: string): Promise<{
    updates: acp.SessionUpdate[];
    configOptions: acp.SessionConfigOption[];
    modes?: AgentModeState;
  }> {
    await this.start();
    const capabilities = this.init?.agentCapabilities as acp.AgentCapabilities & { loadSession?: boolean };
    const sessionCaps = this.init?.agentCapabilities?.sessionCapabilities as acp.SessionCapabilities | undefined;
    const canLoad = capabilities?.loadSession === true;
    const canResume = Boolean(sessionCaps?.resume);
    if (this.historyKnown.has(id) || (!canLoad && !canResume)) return this.sessionView(id);
    const pending = this.attaching.get(id);
    if (pending) {
      await pending;
      return this.sessionView(id);
    }
    const task = this.attachSession(id, canLoad).finally(() => {
      if (this.attaching.get(id) === task) this.attaching.delete(id);
    });
    this.attaching.set(id, task);
    await task;
    return this.sessionView(id);
  }

  private async attachSession(id: string, canLoad: boolean): Promise<void> {
    const generation = this.generation;
    const epoch = this.sessionEpoch.get(id) ?? 0;
    const ctx = await this.ensure();
    if (generation !== this.generation || epoch !== (this.sessionEpoch.get(id) ?? 0) || this.historyKnown.has(id)) return;
    if (this.attached.has(id) && !canLoad) {
      // Sessions created or forked here are already attached; ACP resume is
      // for reattaching, and this agent cannot replay history.
      this.historyKnown.add(id);
      if (!this.history.has(id)) this.history.set(id, []);
      return;
    }
    const sessionCaps = this.init?.agentCapabilities?.sessionCapabilities as acp.SessionCapabilities | undefined;
    const promptSupported = Boolean(sessionCaps?.systemPrompt);
    const mcpServers = this.sessionMcp.get(id) ?? this.sessionMcpServers();
    const systemPrompt = promptSupported
      ? this.sessionPrompt.has(id)
        ? this.sessionPrompt.get(id) ?? undefined
        : this.sessionSystemPrompt()
      : undefined;
    if (!canLoad) {
      // Agents that support resume but not load can still be attached and
      // prompted; ACP does not replay history in this case. Record snapshots
      // only after the request succeeds so a rejected prompt can be retried.
      const result = await ctx.request(acp.methods.agent.session.resume, {
        sessionId: id,
        cwd: this.dir,
        mcpServers,
        ...(systemPrompt ? { systemPrompt } : {}),
      });
      if (generation !== this.generation || epoch !== (this.sessionEpoch.get(id) ?? 0)) return;
      this.attached.add(id);
      this.historyKnown.add(id);
      if (!this.history.has(id)) this.history.set(id, []);
      this.sessionMcp.set(id, mcpServers);
      if (promptSupported) this.sessionPrompt.set(id, systemPrompt ?? null);
      if (result.configOptions) this.configs.set(id, result.configOptions);
      const modes = modeStateFrom(result.modes, result.configOptions ?? this.configs.get(id) ?? []);
      if (modes) this.modeStates.set(id, modes);
      return;
    }
    const replay: acp.SessionUpdate[] = [];
    this.replays.set(id, replay);
    try {
      const result = await ctx.request(acp.methods.agent.session.load, {
        sessionId: id,
        cwd: this.dir,
        mcpServers,
        ...(systemPrompt ? { systemPrompt } : {}),
      });
      if (generation !== this.generation || epoch !== (this.sessionEpoch.get(id) ?? 0)) return;
      this.attached.add(id);
      this.historyKnown.add(id);
      this.history.set(id, replay);
      this.sessionMcp.set(id, mcpServers);
      if (promptSupported) this.sessionPrompt.set(id, systemPrompt ?? null);
      if (result.configOptions) this.configs.set(id, result.configOptions);
      const modes = modeStateFrom(result.modes, result.configOptions ?? this.configs.get(id) ?? []);
      if (modes) this.modeStates.set(id, modes);
    } finally {
      this.replays.delete(id);
    }
  }

  async prompt(sessionID: string, content: acp.ContentBlock[]): Promise<{ accepted: true }> {
    const ctx = await this.ensure();
    this.busy.add(sessionID);
    this.emit({ type: 'busy', sessionID, busy: true });
    const run = ctx.request(acp.methods.agent.session.prompt, {
      sessionId: sessionID,
      prompt: content,
    });
    void run.then((result) => {
      this.emit({ type: 'prompt_done', sessionID, stopReason: result.stopReason, usage: (result as { usage?: unknown }).usage });
    }).catch((error) => {
      this.emit({ type: 'state', status: 'error', message: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      this.busy.delete(sessionID);
      this.emit({ type: 'busy', sessionID, busy: false });
    });
    return { accepted: true };
  }

  async cancel(sessionID: string): Promise<void> {
    const ctx = await this.ensure();
    await ctx.notify(acp.methods.agent.session.cancel, { sessionId: sessionID });
    this.cancelForms(sessionID);
    this.cancelPermissions(sessionID);
  }

  async authenticate(methodID: string): Promise<void> {
    const ctx = await this.ensure();
    const method = this.init?.authMethods?.find((entry) => entry.id === methodID);
    if (!method) throw new Error(`Unknown auth method: ${methodID}`);
    if ('type' in method && method.type === 'terminal') {
      throw new Error('Terminal authentication is not supported yet');
    }
    await ctx.request(acp.methods.agent.authenticate, { methodId: methodID });
    this.authenticated = true;
    this.authRequired = false;
    this.resetBootstrapState();
  }

  async logout(): Promise<void> {
    const ctx = await this.ensure();
    const auth = (this.init?.agentCapabilities as { auth?: { logout?: unknown } } | undefined)?.auth;
    if (!auth?.logout) throw new Error('Agent does not support logout');
    await ctx.request(acp.methods.agent.logout, {});
    this.authenticated = false;
    this.authRequired = (this.init?.authMethods?.length ?? 0) > 0;
    this.resetBootstrapState();
  }

  private resetBootstrapState(): void {
    this.bootEpoch += 1;
    const boot = this.boot;
    const wasUsed = this.bootstrapUsed;
    this.boot = undefined;
    this.bootstrapUsed = false;
    if (boot && !wasUsed) this.retireBootstrap(boot.sessionId);
  }

  private isAuthRequired(error: unknown): boolean {
    return error instanceof RequestError && error.code === -32000;
  }

  async setConfig(sessionID: string, configID: string, value: string | boolean): Promise<acp.SessionConfigOption[]> {
    const ctx = await this.ensure();
    const request = typeof value === 'boolean'
      ? { sessionId: sessionID, configId: configID, type: 'boolean' as const, value }
      : { sessionId: sessionID, configId: configID, value };
    const result = await ctx.request(acp.methods.agent.session.setConfigOption, request as acp.SetSessionConfigOptionRequest);
    const options = result.configOptions ?? this.configs.get(sessionID) ?? [];
    this.configs.set(sessionID, options);
    if (sessionID === this.boot?.sessionId) {
      this.boot = { ...this.boot, configOptions: options };
    }
    return options;
  }

  modes(sessionID: string): AgentModeState | undefined {
    return this.modeStates.get(sessionID)?.state;
  }

  async setMode(sessionID: string, modeID: string): Promise<AgentModeState> {
    const ctx = await this.ensure();
    const stored = this.modeStates.get(sessionID);
    if (!stored) throw new Error('session modes are not available');
    if (!stored.state.availableModes.some((mode) => mode.id === modeID)) {
      throw new Error(`Unknown session mode: ${modeID}`);
    }

    if (stored.configID) {
      const result = await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId: sessionID,
        configId: stored.configID,
        value: modeID,
      } as acp.SetSessionConfigOptionRequest);
      const configOptions = result.configOptions ?? this.configs.get(sessionID) ?? [];
      this.configs.set(sessionID, configOptions);
      const parsed = modeStateFrom(undefined, configOptions);
      if (parsed) {
        this.modeStates.set(sessionID, parsed);
      } else {
        stored.state.currentModeId = modeID;
      }
    } else {
      await ctx.request(acp.methods.agent.session.setMode, {
        sessionId: sessionID,
        modeId: modeID,
      });
      stored.state.currentModeId = modeID;
    }

    const state = this.modeStates.get(sessionID)?.state ?? stored.state;
    if (sessionID === this.boot?.sessionId) {
      this.boot = { ...this.boot, modes: state };
    }
    return state;
  }

  async remove(sessionID: string): Promise<void> {
    const ctx = await this.ensure();
    this.cancelForms(sessionID);
    this.cancelPermissions(sessionID);
    try {
      await ctx.request(acp.methods.agent.session.delete, { sessionId: sessionID });
    } catch (error) {
      // ACP treats deleting an already-missing session as success.
      if (!(error instanceof RequestError && error.code === -32002)) throw error;
    }
    await this.acpTerminals.closeSession(sessionID);
    this.forgetSession(sessionID);
    this.emit({ type: 'sessions_changed' });
  }

  async closeSession(sessionID: string): Promise<void> {
    const capabilities = this.init?.agentCapabilities?.sessionCapabilities as
      | acp.SessionCapabilities
      | undefined;
    if (!capabilities?.close) throw new Error('Agent does not support session/close');
    const ctx = await this.ensure();
    this.cancelForms(sessionID);
    this.cancelPermissions(sessionID);
    try {
      await ctx.request(acp.methods.agent.session.close, { sessionId: sessionID });
    } catch (error) {
      // ACP treats closing an already-missing session as success.
      if (!(error instanceof RequestError && error.code === -32002)) throw error;
    }
    await this.acpTerminals.closeSession(sessionID);
    this.forgetSession(sessionID, true);
    this.emit({ type: 'sessions_changed' });
  }

  private forgetSession(sessionID: string, keepTitle = false): void {
    this.configs.delete(sessionID);
    this.modeStates.delete(sessionID);
    if (!keepTitle) this.titles.delete(sessionID);
    this.history.delete(sessionID);
    this.replays.delete(sessionID);
    this.sessionMcp.delete(sessionID);
    this.sessionPrompt.delete(sessionID);
    this.attached.delete(sessionID);
    this.historyKnown.delete(sessionID);
    this.attaching.delete(sessionID);
    this.bumpSession(sessionID);
    this.busy.delete(sessionID);
    this.retiredBootstraps.delete(sessionID);
    if (this.boot?.sessionId === sessionID) {
      this.bootEpoch += 1;
      this.boot = undefined;
      this.bootstrapUsed = false;
    }
  }

  async fork(sessionID: string): Promise<{ id: string; title: string; time: { created: number; updated: number }; configOptions: acp.SessionConfigOption[]; modes?: AgentModeState }> {
    const ctx = await this.ensure();
    const mcpServers = this.sessionMcpServers();
    const systemPrompt = this.sessionSystemPrompt();
    const result = await ctx.request('session/fork', {
      sessionId: sessionID,
      cwd: this.dir,
      mcpServers,
      ...(systemPrompt ? { systemPrompt } : {}),
    }) as {
      sessionId: string;
      configOptions?: acp.SessionConfigOption[];
      modes?: acp.SessionModeState | null;
    };
    const configOptions = result.configOptions ?? [];
    const modes = modeStateFrom(result.modes, configOptions);
    this.configs.set(result.sessionId, configOptions);
    this.sessionMcp.set(result.sessionId, mcpServers);
    this.sessionPrompt.set(result.sessionId, systemPrompt ?? null);
    this.attached.add(result.sessionId);
    if (modes) this.modeStates.set(result.sessionId, modes);
    return {
      id: result.sessionId,
      title: 'New chat',
      time: { created: Date.now(), updated: Date.now() },
      configOptions,
      modes: modes?.state,
    };
  }

  permissions(sessionID: string): AgentPermission[] {
    return [...this.pending.entries()]
      .filter(([, pending]) => pending.params.sessionId === sessionID)
      .map(([id, pending]) => permissionInfo(id, pending.params));
  }

  async replyPermission(requestID: string, optionID: string): Promise<void> {
    const pending = this.pending.get(requestID);
    if (!pending) throw new Error('permission request not found');
    if (!pending.params.options.some((option) => option.optionId === optionID)) {
      throw new Error(`Unknown permission option: ${optionID}`);
    }
    pending.resolve({ outcome: { outcome: 'selected', optionId: optionID } });
    this.pending.delete(requestID);
    this.emit({ type: 'permission_replied', requestID, sessionID: pending.params.sessionId });
  }

  private requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const id = `perm_${++this.permissionSeq}`;
    return new Promise((resolve) => {
      this.pending.set(id, { params, resolve });
      this.emit({ type: 'permission', request: permissionInfo(id, params) });
    });
  }

  forms(sessionID: string): AgentForm[] {
    return [...this.pendingForms.values()]
      .filter((pending) => pending.form.sessionID === sessionID)
      .map((pending) => pending.form);
  }

  async replyForm(
    formID: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, unknown>,
  ): Promise<void> {
    const pending = this.pendingForms.get(formID);
    if (!pending) throw new Error('form request not found');
    pending.resolve(formResponse(action, content));
    this.pendingForms.delete(formID);
    this.emit({ type: 'form_replied', formID, sessionID: pending.form.sessionID });
  }

  private requestForm(params: acp.CreateElicitationRequest): Promise<acp.CreateElicitationResponse> {
    const form = formFromElicitation(`form_${++this.formSeq}`, params);
    if (!form) return Promise.resolve({ action: 'decline' });
    return new Promise((resolve) => {
      this.pendingForms.set(form.id, { form, resolve });
      this.emit({ type: 'form', form });
    });
  }

  private cancelForms(sessionID?: string): void {
    for (const [formID, pending] of this.pendingForms) {
      if (sessionID && pending.form.sessionID !== sessionID) continue;
      pending.resolve({ action: 'cancel' });
      this.pendingForms.delete(formID);
      this.emit({ type: 'form_replied', formID, sessionID: pending.form.sessionID });
    }
  }

  private cancelPermissions(sessionID?: string): void {
    for (const [requestID, pending] of this.pending) {
      if (sessionID && pending.params.sessionId !== sessionID) continue;
      pending.resolve({ outcome: { outcome: 'cancelled' } });
      this.pending.delete(requestID);
      this.emit({ type: 'permission_replied', requestID, sessionID: pending.params.sessionId });
    }
  }

  private onUpdate(params: acp.SessionNotification): void {
    const update = params.update;
    // Notices are live UI events; keep them out of the replayed history.
    const liveOnly = update.sessionUpdate === 'notice';
    const replay = this.replays.get(params.sessionId);
    if (replay && !liveOnly) {
      replay.push(update);
      return;
    }
    if (!liveOnly) {
      const history = this.history.get(params.sessionId) ?? [];
      history.push(update);
      this.history.set(params.sessionId, history);
    }
    if (update.sessionUpdate === 'available_commands_update') {
      this.commands = update.availableCommands;
      this.emit({ type: 'commands', commands: this.commands });
    }
    if (update.sessionUpdate === 'session_info_update' && 'title' in update && typeof update.title === 'string') {
      this.titles.set(params.sessionId, update.title);
      this.emit({ type: 'sessions_changed' });
    }
    if (update.sessionUpdate === 'current_mode_update') {
      const stored = this.modeStates.get(params.sessionId);
      if (stored) {
        stored.state.currentModeId = update.currentModeId;
        if (params.sessionId === this.boot?.sessionId) {
          this.boot = { ...this.boot, modes: stored.state };
        }
      }
    }
    if (update.sessionUpdate === 'config_option_update') {
      this.configs.set(params.sessionId, update.configOptions);
      const modes = modeStateFrom(undefined, update.configOptions);
      if (modes) {
        this.modeStates.set(params.sessionId, modes);
        if (params.sessionId === this.boot?.sessionId) {
          this.boot = { ...this.boot, configOptions: update.configOptions, modes: modes.state };
        }
      } else if (params.sessionId === this.boot?.sessionId) {
        this.boot = { ...this.boot, configOptions: update.configOptions };
      }
    }
    this.emit({ type: 'update', sessionID: params.sessionId, update, created: Date.now() });
  }

  private async stopProcess(): Promise<void> {
    this.clearStartTimer();
    await this.acpTerminals.close();
    this.cancelForms();
    this.cancelPermissions();
    const child = this.child;
    const closed = this.closedPromise;
    this.child = undefined;
    this.context = undefined;
    if (child) {
      try { child.stdin?.end(); } catch { /* ignore */ }
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      await Promise.race([
        closed ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
    this.readyPromise = undefined;
    this.readyResolve = undefined;
    this.readyReject = undefined;
    this.closedPromise = undefined;
    this.closedResolve = undefined;
    this.init = undefined;
    this.error = undefined;
    this.authRequired = false;
    this.authenticated = false;
    this.bootEpoch += 1;
    this.boot = undefined;
    this.bootPending = undefined;
    this.bootstrapUsed = false;
    this.retiredBootstraps.clear();
    this.sessionMcp.clear();
    this.sessionPrompt.clear();
    this.attached.clear();
    this.historyKnown.clear();
    this.attaching.clear();
    this.sessionEpoch.clear();
    this.generation += 1;
    this.commands = [];
    this.configs.clear();
    this.modeStates.clear();
    this.titles.clear();
    this.busy.clear();
    this.history.clear();
    this.replays.clear();
    this.permissionSeq = 0;
    this.formSeq = 0;
  }

  async close(): Promise<void> {
    const unusedBoot = this.bootstrapUsed ? undefined : this.boot;
    if (unusedBoot) {
      await Promise.race([
        this.deleteSession(unusedBoot.sessionId),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }
    this.disposed = true;
    await this.stopProcess();
  }
}

export class AcpAgent {
  private available?: DiscoveredAgent[];
  private mcp: acp.McpServer[] = [];
  private promptText?: string;
  private selectedID?: string;
  private active?: AgentRuntime;
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private disposed = false;

  constructor(
    private readonly dir: string,
    private readonly files: FileStore = new FileStore(dir),
  ) {}

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* 客户端断开不应影响 agent */ }
    }
  }

  async discovery(): Promise<AgentDiscovery> {
    const agents = await this.ensureDiscovery();
    return {
      agents: agentOptions(agents, this.selectedID),
      selectedAgent: this.selectedID,
    };
  }

  async selectAgent(id: string): Promise<AgentDiscovery> {
    const agents = await this.ensureDiscovery();
    const next = agents.find((entry) => entry.profile.id === id);
    if (!next) throw new Error(`ACP agent not found: ${id}`);
    this.selectedID = id;
    this.active = this.runtimeFor(next);
    return this.discovery();
  }

  private async ensureDiscovery(): Promise<DiscoveredAgent[]> {
    if (this.available && this.available.length > 0) return this.available;
    const agents = await discoverAgents();
    this.available = agents;
    if (!this.selectedID && agents[0]) this.selectedID = agents[0].profile.id;
    return agents;
  }

  mcpServers(): acp.McpServer[] {
    return this.mcp;
  }

  setMcpServers(servers: acp.McpServer[]): acp.McpServer[] {
    if (mcpServersEqual(this.mcp, servers)) return this.mcp;
    this.mcp = servers;
    for (const runtime of this.runtimes.values()) runtime.invalidateBootstrap();
    return this.mcp;
  }

  systemPrompt(): string | undefined {
    return this.promptText;
  }

  setSystemPrompt(text: string | undefined): string | undefined {
    if (this.promptText === text) return this.promptText;
    this.promptText = text;
    for (const runtime of this.runtimes.values()) runtime.invalidateBootstrap();
    return this.promptText;
  }

  private runtimeFor(discovered: DiscoveredAgent): AgentRuntime {
    const id = discovered.profile.id;
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = new AgentRuntime(
        this.dir,
        discovered,
        this.files,
        () => this.mcp,
        () => this.promptText,
      );
      runtime.subscribe((event) => {
        if (this.active === runtime) this.emit(event);
      });
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }

  private async ensureActive(): Promise<AgentRuntime> {
    if (this.disposed) throw new Error('agent host is disposed');
    const agents = await this.ensureDiscovery();
    if (this.active) return this.active;
    if (!this.selectedID) {
      throw new Error('No native ACP agent found. Install OpenCode (`opencode acp`) or Command Code (`command-code acp`).');
    }
    const selected = agents.find((entry) => entry.profile.id === this.selectedID);
    if (!selected) throw new Error(`ACP agent not found: ${this.selectedID}`);
    this.active = this.runtimeFor(selected);
    return this.active;
  }

  async status(): Promise<AgentStatus> {
    try {
      const runtime = await this.ensureActive();
      const status = await runtime.status();
      const discovery = await this.discovery();
      return {
        ...status,
        availableAgents: discovery.agents,
        selectedAgent: discovery.selectedAgent,
      };
    } catch (error) {
      let discovery: AgentDiscovery = { agents: [] };
      try { discovery = await this.discovery(); } catch { /* discovery is best effort on failure */ }
      return {
        ready: false,
        error: error instanceof Error ? error.message : String(error),
        availableAgents: discovery.agents,
        selectedAgent: discovery.selectedAgent,
      };
    }
  }

  async modelsResponse(): Promise<AgentModel[]> { return (await this.ensureActive()).modelsResponse(); }
  async providers(): Promise<Array<{ id: string; name: string; activation: string }>> { return (await this.ensureActive()).providers(); }
  async commandsResponse(): Promise<acp.AvailableCommand[]> { return (await this.ensureActive()).commandsResponse(); }
  async listSessions() { return (await this.ensureActive()).listSessions(); }
  async session(id: string) { return (await this.ensureActive()).session(id); }
  async createSession() { return (await this.ensureActive()).createSession(); }
  async messages(id: string) { return (await this.ensureActive()).messages(id); }
  async prompt(sessionID: string, content: acp.ContentBlock[]) { return (await this.ensureActive()).prompt(sessionID, content); }
  async cancel(sessionID: string) { return (await this.ensureActive()).cancel(sessionID); }
  async authenticate(methodID: string) {
    const runtime = await this.ensureActive();
    await runtime.authenticate(methodID);
    return this.status();
  }
  async logout() {
    const runtime = await this.ensureActive();
    await runtime.logout();
    return this.status();
  }
  async setConfig(sessionID: string, configID: string, value: string | boolean) { return (await this.ensureActive()).setConfig(sessionID, configID, value); }
  modes(sessionID: string) { return this.active?.modes(sessionID); }
  async setMode(sessionID: string, modeID: string) { return (await this.ensureActive()).setMode(sessionID, modeID); }
  async remove(sessionID: string) { return (await this.ensureActive()).remove(sessionID); }
  async closeSession(sessionID: string) { return (await this.ensureActive()).closeSession(sessionID); }
  async fork(sessionID: string) { return (await this.ensureActive()).fork(sessionID); }
  permissions(sessionID: string) { return this.active?.permissions(sessionID) ?? []; }
  async replyPermission(requestID: string, optionID: string) { return (await this.ensureActive()).replyPermission(requestID, optionID); }
  forms(sessionID: string) { return this.active?.forms(sessionID) ?? []; }
  async replyForm(formID: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>) { return (await this.ensureActive()).replyForm(formID, action, content); }

  async close(): Promise<void> {
    this.disposed = true;
    const runtimes = [...this.runtimes.values()];
    this.runtimes.clear();
    this.active = undefined;
    await Promise.all(runtimes.map((runtime) => runtime.close()));
  }
}

function agentOptions(agents: DiscoveredAgent[], selectedID?: string): AgentOption[] {
  return agents.map((entry) => ({
    id: entry.profile.id,
    name: entry.profile.name,
    selected: entry.profile.id === selectedID,
  }));
}

function modeStateFrom(
  modes: acp.SessionModeState | null | undefined,
  configOptions: acp.SessionConfigOption[] | null | undefined,
): StoredModes | undefined {
  if (modes && modes.availableModes.length > 0) {
    return {
      state: {
        currentModeId: modes.currentModeId,
        availableModes: modes.availableModes.map((mode) => ({
          id: mode.id,
          name: mode.name,
          description: mode.description ?? undefined,
        })),
      },
    };
  }

  const option = configOptions?.find((entry) => entry.type === 'select'
    && (entry.category === 'mode' || entry.id === 'mode'));
  if (!option || option.type !== 'select' || typeof option.currentValue !== 'string') return undefined;
  const entries = option.options.flatMap((entry) => 'options' in entry ? entry.options : [entry]);
  if (entries.length === 0) return undefined;
  return {
    configID: option.id,
    state: {
      currentModeId: option.currentValue,
      availableModes: entries.map((entry) => ({
        id: entry.value,
        name: entry.name,
        description: entry.description ?? undefined,
      })),
    },
  };
}

function splitModel(value: string): { providerID: string; id: string } {
  const slash = value.indexOf('/');
  return slash < 0 ? { providerID: 'agent', id: value } : { providerID: value.slice(0, slash), id: value.slice(slash + 1) };
}

function permissionInfo(id: string, params: acp.RequestPermissionRequest): AgentPermission {
  const title = params.toolCall.title || 'Permission required';
  const message = params.toolCall.content?.[0]?.type === 'content' && params.toolCall.content[0].content.type === 'text'
    ? params.toolCall.content[0].content.text
    : undefined;
  return {
    id,
    sessionID: params.sessionId,
    title,
    kind: params.toolCall.kind ?? undefined,
    message,
    options: params.options,
  };
}
