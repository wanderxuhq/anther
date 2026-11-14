// server/features.ts
// First-party optional feature packages: anther core does not depend on them.
// A feature declares panels (route + UI bundle) and registers workspace routes.
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { HttpServer, Router } from './http.ts';

export type FeaturePanel = {
  /** Panel ID, unique across features. */
  id: string;
  title: string;
  /** anther icon name, e.g. sparkles. */
  icon: string;
  /** Top-level frontend route, e.g. /_/example. */
  route: string;
  /** Runtime ESM bundle, served by the feature and loaded by the browser. */
  ui: string;
};

export type FeatureInfo = {
  id: string;
  version: string;
  panels: FeaturePanel[];
};

export type FeatureFlags = Record<string, FeatureInfo>;

export type WorkspaceFeatureContext = {
  /** Canonical workspace path. */
  dir: string;
  /** Router for this mount only. */
  router: Router;
  /** Mount prefix: '' for the host, '/-/name/-/0' for attached workspaces. */
  base: string;
};

export type WorkspaceFeatureHook = (ctx: WorkspaceFeatureContext) => void;

/** Anther-owned state directory API. Features never compute ~/.anther paths themselves. */
export type FeatureState = {
  /** Root state directory, e.g. ~/.anther. */
  readonly root: string;
  /** Feature directory path; does not create it. */
  dir(featureID: string): string;
  /** File path under the feature directory; does not create parents. */
  file(featureID: string, ...segments: string[]): string;
  /** Create the feature directory and return it. */
  ensure(featureID: string): Promise<string>;
};

export type FeatureContext = {
  http: HttpServer;
  state: FeatureState;
  onWorkspace(hook: WorkspaceFeatureHook): void;
  onDispose(fn: () => void | Promise<void>): void;
};

export type FeatureModule = {
  feature: FeatureInfo;
  register(ctx: FeatureContext): void | Promise<void>;
};

/** Routes owned by anther core; feature packages may not claim them. */
const RESERVED_ROUTES = new Set(['/_/file', '/_/database', '/_/git', '/_/plugin']);
const PANEL_ROUTE_RE = /^\/_\/[a-z0-9][a-z0-9-]*$/;

const FEATURE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function createFeatureState(root: string): FeatureState {
  const resolvedRoot = path.resolve(root);
  const featureDir = (featureID: string): string => {
    if (!FEATURE_ID_RE.test(featureID)) throw new Error(`invalid feature id: ${featureID}`);
    return path.join(resolvedRoot, featureID);
  };
  return {
    root: resolvedRoot,
    dir: featureDir,
    file(featureID, ...segments) {
      if (segments.length === 0) throw new Error('state file requires a name');
      for (const segment of segments) {
        if (!SEGMENT_RE.test(segment) || segment === '.' || segment === '..') {
          throw new Error(`invalid state path segment: ${segment}`);
        }
      }
      const dir = featureDir(featureID);
      const file = path.resolve(dir, ...segments);
      if (!file.startsWith(dir + path.sep)) throw new Error('state path escapes feature directory');
      return file;
    },
    async ensure(featureID) {
      const dir = featureDir(featureID);
      // Feature state may contain credentials (for example an API key), so keep
      // newly created feature directories private to the current user.
      await mkdir(dir, { recursive: true, mode: 0o700 });
      return dir;
    },
  };
}

export class FeatureRegistry {
  private readonly flags: FeatureFlags = {};
  private readonly state: FeatureState;
  private readonly hooks: WorkspaceFeatureHook[] = [];
  private readonly disposers: (() => void | Promise<void>)[] = [];
  private loaded = false;

  constructor(stateRoot = process.env.ANTHER_STATE_DIR ?? path.join(homedir(), '.anther')) {
    this.state = createFeatureState(stateRoot);
  }

  /** Loads explicitly configured feature package specifiers; never scans node_modules. */
  async load(http: HttpServer, specs: readonly string[] = []): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const knownPanelIDs = new Set<string>();
    const knownRoutes = new Set<string>();
    const ctx: FeatureContext = {
      http,
      state: this.state,
      onWorkspace: (hook) => this.hooks.push(hook),
      onDispose: (fn) => this.disposers.push(fn),
    };

    for (const spec of specs) {
      const hookCount = this.hooks.length;
      const disposerCount = this.disposers.length;
      try {
        const mod = (await import(spec)) as Partial<FeatureModule>;
        if (!isFeatureInfo(mod.feature) || typeof mod.register !== 'function') {
          console.warn(`feature ${spec}: invalid module (missing feature/register)`);
          continue;
        }
        if (!validPanels(mod.feature, knownPanelIDs, knownRoutes)) {
          console.warn(`feature ${mod.feature.id}: invalid or conflicting panels`);
          continue;
        }
        await mod.register(ctx);
        this.flags[mod.feature.id] = mod.feature;
        for (const panel of mod.feature.panels) {
          knownPanelIDs.add(panel.id);
          knownRoutes.add(panel.route);
        }
      } catch (e) {
        this.hooks.length = hookCount;
        this.disposers.length = disposerCount;
        if (isMissingModule(e, spec)) continue;
        console.warn(`feature ${spec} failed to load:`, e);
      }
    }
  }

  snapshot(): FeatureFlags {
    return { ...this.flags };
  }

  /** Called once per mount (host + every attached workspace). */
  mount(ctx: WorkspaceFeatureContext): void {
    ctx.router.get('/api/features', () => this.snapshot());
    for (const hook of this.hooks) {
      try {
        hook(ctx);
      } catch (e) {
        console.warn('feature workspace hook failed:', e);
      }
    }
  }

  async dispose(): Promise<void> {
    for (const fn of [...this.disposers].reverse()) {
      try {
        await fn();
      } catch (e) {
        console.warn('feature dispose failed:', e);
      }
    }
    this.disposers.length = 0;
    this.hooks.length = 0;
  }
}

function isFeatureInfo(value: unknown): value is FeatureInfo {
  if (!value || typeof value !== 'object') return false;
  const feature = value as Partial<FeatureInfo>;
  return typeof feature.id === 'string' && feature.id.length > 0
    && typeof feature.version === 'string'
    && Array.isArray(feature.panels) && feature.panels.length > 0;
}

function validPanels(
  feature: FeatureInfo,
  knownPanelIDs: ReadonlySet<string>,
  knownRoutes: ReadonlySet<string>,
): boolean {
  const localIDs = new Set<string>();
  const localRoutes = new Set<string>();
  for (const panel of feature.panels) {
    if (!panel || typeof panel !== 'object') return false;
    if (typeof panel.id !== 'string' || panel.id.length === 0) return false;
    if (typeof panel.title !== 'string' || panel.title.length === 0) return false;
    if (typeof panel.icon !== 'string' || panel.icon.length === 0) return false;
    if (typeof panel.route !== 'string' || !PANEL_ROUTE_RE.test(panel.route)) return false;
    if (RESERVED_ROUTES.has(panel.route)) return false;
    if (typeof panel.ui !== 'string' || !panel.ui.startsWith(`${panel.route}/`)) return false;
    if (knownPanelIDs.has(panel.id) || localIDs.has(panel.id)) return false;
    if (knownRoutes.has(panel.route) || localRoutes.has(panel.route)) return false;
    localIDs.add(panel.id);
    localRoutes.add(panel.route);
  }
  return true;
}

function isMissingModule(error: unknown, spec: string): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND'
    && error.message.includes(spec);
}
