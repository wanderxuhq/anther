// server/skills.ts
// Built-in skills installer backed by vercel-labs/skills. The package is
// loaded lazily so anther itself keeps running on older Node versions, and all
// install/remove calls disable telemetry explicitly. The package writes skill
// folders and skills-lock.json itself; that is a deliberate workspace-level
// exception, like git/archive handling, because FileStore only handles files.
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentInfo,
  Diagnostic,
  InstalledSkillInfo,
  SkillInfo,
  SkillSource,
  SourceInfo,
} from 'skills';
import { discoverAgents } from './agent-profiles.ts';

type SkillsModule = typeof import('skills');

const PREVIEW_TTL_MS = 15 * 60_000;
const MAX_PREVIEWS = 8;
const MIN_NODE = [22, 20] as const;

/** anther ACP agent IDs → IDs used by the skills package. */
const SKILLS_AGENT_IDS: Record<string, string> = {
  opencode: 'opencode',
  'command-code': 'command-code',
};

export type SkillTarget = {
  id: string;
  name: string;
  /** Skills directory relative to the workspace. */
  dir: string;
  universal: boolean;
};

export type SkillDiagnostic = {
  code: string;
  message: string;
  fix?: string;
};

export type SkillSourcePreview = {
  token: string;
  source: {
    input: string;
    type: string;
    url: string;
    ref?: string;
    commit?: string;
    subpath?: string;
  };
  skills: Array<{
    name: string;
    description: string;
    path?: string;
    duplicates?: string[];
    pluginName?: string;
    metadata?: Record<string, unknown>;
  }>;
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

export type SkillInstallTarget = {
  skill: string;
  agent: string;
  scope: 'project';
  mode: 'symlink' | 'copy';
  path: string;
  canonicalPath?: string;
};

export type SkillInstallResult = {
  source: SkillSourcePreview['source'];
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

export type SkillResolveOptions = {
  ref?: string;
  fullDepth?: boolean;
  includeInternal?: boolean;
};

export class SkillError extends Error {
  constructor(
    public code: string,
    message: string,
    public fix?: string,
  ) {
    super(message);
  }
}

type PendingPreview = {
  preview: SkillSourcePreview;
  source: SkillSource;
  timer: NodeJS.Timeout;
};

let skillsPromise: Promise<SkillsModule> | undefined;

function loadSkills(): Promise<SkillsModule> {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    return Promise.reject(new SkillError(
      'SKILLS_UNSUPPORTED_NODE',
      `Installing skills requires Node.js ${MIN_NODE[0]}.${MIN_NODE[1]} or newer.`,
    ));
  }
  if (!skillsPromise) {
    skillsPromise = import('skills').catch((error: unknown) => {
      skillsPromise = undefined;
      throw new SkillError(
        'SKILLS_UNAVAILABLE',
        error instanceof Error ? error.message : 'Skills are unavailable.',
      );
    });
  }
  return skillsPromise;
}

/** Map anther's discovered ACP agents to installable skills targets. */
export function skillTargets(
  agentIDs: readonly string[],
  supported: readonly AgentInfo[],
): SkillTarget[] {
  const byID = new Map(supported.map((agent) => [agent.id, agent]));
  const seenIDs = new Set<string>();
  const seenDirs = new Set<string>();
  const targets: SkillTarget[] = [];
  // A specific agent wins over the neutral universal target when both use
  // the same directory (for example OpenCode's .agents/skills).
  const ordered = [...agentIDs].sort((a, b) => Number(a === 'universal') - Number(b === 'universal'));
  for (const agentID of ordered) {
    const skillID = SKILLS_AGENT_IDS[agentID] ?? agentID;
    const agent = byID.get(skillID);
    if (!agent || seenIDs.has(agent.id) || seenDirs.has(agent.projectSkillsDir)) continue;
    seenIDs.add(agent.id);
    seenDirs.add(agent.projectSkillsDir);
    targets.push({
      id: agent.id,
      name: agent.name,
      dir: agent.projectSkillsDir,
      universal: agent.universal,
    });
  }
  if (!targets.length) {
    const universal = byID.get('universal');
    if (universal && !seenDirs.has(universal.projectSkillsDir)) {
      targets.push({
        id: universal.id,
        name: universal.name,
        dir: universal.projectSkillsDir,
        universal: universal.universal,
      });
    }
  }
  return targets;
}

function diagnostic(error: Diagnostic<unknown>): SkillDiagnostic {
  return {
    code: error.code || 'SKILLS_ERROR',
    message: error.message || 'Skills operation failed',
    ...(error.fix ? { fix: error.fix } : {}),
  };
}

function isLocalSource(input: string): boolean {
  return path.isAbsolute(input)
    || input.startsWith('./')
    || input.startsWith('../')
    || input === '.'
    || input === '..'
    || /^[a-zA-Z]:[/\\]/.test(input);
}

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isNotFound(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

// The installed skills version requires at least one code for its type guard,
// so recognized diagnostics structurally instead of calling isDiagnostic().
function isDiagnosticError(error: unknown): error is Diagnostic<unknown> {
  if (!(error instanceof Error)) return false;
  const value = error as { code?: unknown; name?: unknown; why?: unknown };
  if (typeof value.code !== 'string' || value.name !== value.code) return false;
  try {
    return typeof value.why === 'string';
  } catch {
    return false;
  }
}

export class SkillManager {
  private readonly cwd: string;
  private readonly pending = new Map<string, PendingPreview>();
  private readonly controllers = new Set<AbortController>();
  private writeQueue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(cwd: string) {
    this.cwd = path.resolve(cwd);
  }

  async targets(): Promise<SkillTarget[]> {
    const skills = await loadSkills();
    return this.discoveredTargets(skills);
  }

  async list(): Promise<{ skills: InstalledSkill[]; targets: SkillTarget[]; agents: Record<string, string> }> {
    const skills = await loadSkills();
    const targets = await this.discoveredTargets(skills);
    try {
      const result = await skills.listSkills({ cwd: this.cwd, scope: 'project' });
      return {
        targets,
        agents: Object.fromEntries(skills.getSupportedAgents().map((agent) => [agent.id, agent.name])),
        skills: result.skills.map((skill) => this.installedSkill(skill)),
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async resolve(input: string, options: SkillResolveOptions = {}): Promise<SkillSourcePreview> {
    const source = input.trim();
    if (!source) throw new SkillError('SKILLS_SOURCE_REQUIRED', 'A skill source is required.');
    if (this.closed) throw new SkillError('SKILLS_UNAVAILABLE', 'Skills host is closed.');
    await this.assertLocalSource(source);

    const skills = await loadSkills();
    const warnings: SkillDiagnostic[] = [];
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const resolved = await skills.resolveSource(source, {
        cwd: this.cwd,
        signal: controller.signal,
        ...(options.ref ? { ref: options.ref } : {}),
        ...(options.fullDepth ? { fullDepth: true } : {}),
        ...(options.includeInternal ? { includeInternal: true } : {}),
        onWarning: (warning) => warnings.push(diagnostic(warning)),
      });
      if (this.closed) {
        await resolved.dispose().catch(() => {});
        throw new SkillError('SKILLS_UNAVAILABLE', 'Skills host is closed.');
      }
      const token = randomUUID();
      const preview: SkillSourcePreview = {
        token,
        source: this.sourceInfo(resolved.source),
        skills: resolved.skills.map((skill) => this.skillInfo(skill)),
        warnings,
      };
      const timer = setTimeout(() => { void this.drop(token); }, PREVIEW_TTL_MS);
      timer.unref();
      this.pending.set(token, { preview, source: resolved, timer });
      this.trimPreviews();
      return preview;
    } catch (error) {
      throw this.wrap(error);
    } finally {
      this.controllers.delete(controller);
    }
  }

  async install(
    token: string,
    names: readonly string[],
    agents?: readonly string[],
  ): Promise<SkillInstallResult> {
    if (this.closed) throw new SkillError('SKILLS_UNAVAILABLE', 'Skills host is closed.');
    const entry = this.pending.get(token);
    if (!entry) {
      throw new SkillError('SKILLS_PREVIEW_EXPIRED', 'The source preview expired. Fetch the source again.');
    }
    const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    if (!wanted.length) throw new SkillError('SKILLS_NO_SKILLS_SELECTED', 'Select at least one skill.');
    const available = new Set(entry.preview.skills.map((skill) => skill.name));
    for (const name of wanted) {
      if (!available.has(name)) {
        throw new SkillError('SKILLS_NO_MATCHING_SKILLS', `Skill not found in source: ${name}`);
      }
    }

    const skills = await loadSkills();
    const targets = await this.discoveredTargets(skills);
    const targetIDs = targets.map((target) => target.id);
    const selected = agents?.length ? [...new Set(agents)] : targetIDs;
    for (const agent of selected) {
      if (!targetIDs.includes(agent)) {
        throw new SkillError('SKILLS_AGENT_NOT_ALLOWED', `Skills cannot be installed for ${agent}.`);
      }
    }
    if (!selected.length) {
      throw new SkillError('SKILLS_NO_TARGET_AGENTS', 'No skill install target is available.');
    }

    this.pending.delete(token);
    clearTimeout(entry.timer);
    let completed = false;
    try {
      const outcome = await this.serialize(async () => {
        const warnings: SkillDiagnostic[] = [];
        try {
          const result = await skills.installSkills(entry.source, {
            cwd: this.cwd,
            skills: wanted,
            agents: selected,
            scope: 'project',
            mode: 'copy',
            lockfile: true,
            telemetry: false,
            symlinks: 'reject',
            duplicates: 'error',
            onWarning: (warning) => warnings.push(diagnostic(warning)),
          });
          return { result, warnings };
        } catch (error) {
          throw this.wrap(error);
        }
      });
      const result: SkillInstallResult = {
        source: this.sourceInfo(outcome.result.source),
        installed: outcome.result.installed.map((target) => ({
          skill: target.skill,
          agent: target.agent,
          scope: 'project' as const,
          mode: target.mode,
          path: this.relative(target.path),
          ...(target.canonicalPath ? { canonicalPath: this.relative(target.canonicalPath) } : {}),
        })),
        skipped: outcome.result.skipped.map((target) => ({ ...target })),
        failed: outcome.result.failed.map((failure) => ({
          skill: failure.skill,
          agent: failure.agent,
          code: failure.code,
          message: failure.message,
        })),
        warnings: outcome.warnings,
      };
      completed = true;
      return result;
    } catch (error) {
      // Strict installs reject before writing. Keep the fetched source so the
      // user can adjust the selection and retry without cloning it again.
      if (!this.closed && !this.pending.has(token)) {
        const timer = setTimeout(() => { void this.drop(token); }, PREVIEW_TTL_MS);
        timer.unref();
        this.pending.set(token, { preview: entry.preview, source: entry.source, timer });
        this.trimPreviews();
      } else {
        await entry.source.dispose().catch(() => {});
      }
      throw error;
    } finally {
      if (completed) await entry.source.dispose().catch(() => {});
    }
  }

  async remove(name: string, agents?: readonly string[]): Promise<SkillRemoveResult> {
    const skillName = name.trim();
    if (!skillName) throw new SkillError('SKILLS_SKILL_REQUIRED', 'A skill name is required.');
    const skills = await loadSkills();
    const validAgents = new Set(skills.getSupportedAgents().map((agent) => agent.id));
    const warnings: SkillDiagnostic[] = [];
    try {
      let selected = agents?.length ? [...new Set(agents)] : undefined;
      if (!selected) {
        const listed = await skills.listSkills({ cwd: this.cwd, scope: 'project' });
        const found = listed.skills.find((skill) => skill.name === skillName);
        selected = found?.agents.length ? [...found.agents] : undefined;
      }
      if (selected) {
        for (const agent of selected) {
          if (!validAgents.has(agent)) {
            throw new SkillError('SKILLS_INVALID_AGENTS', `Unknown agent: ${agent}`);
          }
        }
      }
      const outcome = await this.serialize(() => skills.removeSkills([skillName], {
        cwd: this.cwd,
        scope: 'project',
        ...(selected?.length ? { agents: selected } : {}),
        lockfile: true,
        telemetry: false,
        onWarning: (warning) => warnings.push(diagnostic(warning)),
      }).catch((error: unknown) => {
        throw this.wrap(error);
      }));
      return {
        removed: [...outcome.removed],
        notFound: [...outcome.notFound],
        failed: outcome.failed.map((failure) => ({
          skill: failure.skill,
          code: failure.code,
          message: failure.message,
        })),
        warnings,
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async dispose(token: string): Promise<boolean> {
    return this.drop(token);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    const pending = [...this.pending.values()];
    this.pending.clear();
    await Promise.all(pending.map((entry) => {
      clearTimeout(entry.timer);
      return entry.source.dispose().catch(() => {});
    }));
    await this.writeQueue.catch(() => {});
  }

  private async discoveredTargets(skills: SkillsModule): Promise<SkillTarget[]> {
    const discovered = await discoverAgents();
    return skillTargets(
      discovered.map((entry) => entry.profile.id),
      skills.getSupportedAgents(),
    );
  }

  private async assertLocalSource(input: string): Promise<void> {
    if (!isLocalSource(input)) return;
    const lexicalRoot = this.cwd;
    const resolved = path.resolve(lexicalRoot, input);
    if (!inside(lexicalRoot, resolved)) {
      throw new SkillError(
        'SKILLS_LOCAL_SOURCE_OUTSIDE_WORKSPACE',
        'Local skill sources must be inside the workspace.',
      );
    }
    const root = await realpath(lexicalRoot).catch(() => lexicalRoot);
    try {
      const real = await realpath(resolved);
      if (!inside(root, real)) {
        throw new SkillError(
          'SKILLS_LOCAL_SOURCE_OUTSIDE_WORKSPACE',
          'Local skill sources must be inside the workspace.',
        );
      }
    } catch (error) {
      if (error instanceof SkillError || !isNotFound(error)) throw error;
    }
  }

  private async drop(token: string): Promise<boolean> {
    const entry = this.pending.get(token);
    if (!entry) return false;
    this.pending.delete(token);
    clearTimeout(entry.timer);
    await entry.source.dispose().catch(() => {});
    return true;
  }

  private trimPreviews(): void {
    while (this.pending.size > MAX_PREVIEWS) {
      const oldest = this.pending.keys().next().value;
      if (!oldest) return;
      void this.drop(oldest);
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private wrap(error: unknown): unknown {
    if (error instanceof SkillError) return error;
    if (isDiagnosticError(error)) {
      return new SkillError(
        error.code || 'SKILLS_ERROR',
        error.message || 'Skills operation failed',
        error.fix,
      );
    }
    return error;
  }

  private relative(file: string): string {
    const rel = path.relative(this.cwd, file);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
      ? rel.split(path.sep).join('/')
      : file;
  }

  private sourceInfo(info: SourceInfo): SkillSourcePreview['source'] {
    return {
      input: info.input,
      type: info.type,
      url: info.type === 'local' ? this.relative(info.url) : info.url,
      ...(info.ref ? { ref: info.ref } : {}),
      ...(info.commit ? { commit: info.commit } : {}),
      ...(info.subpath ? { subpath: info.subpath } : {}),
    };
  }

  private skillInfo(skill: SkillInfo): SkillSourcePreview['skills'][number] {
    return {
      name: skill.name,
      description: skill.description,
      ...(skill.path ? { path: skill.path } : {}),
      ...(skill.duplicates?.length ? { duplicates: [...skill.duplicates] } : {}),
      ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
      ...(skill.metadata ? { metadata: skill.metadata as Record<string, unknown> } : {}),
    };
  }

  private installedSkill(skill: InstalledSkillInfo): InstalledSkill {
    return {
      name: skill.name,
      description: skill.description,
      scope: 'project',
      path: this.relative(skill.path),
      agents: [...skill.agents],
      ...(skill.source
        ? { source: path.isAbsolute(skill.source) ? this.relative(skill.source) : skill.source }
        : {}),
    };
  }
}
