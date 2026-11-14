// server/routes/skills.ts
// HTTP bridge for the built-in skills installer.
import type { Router } from '../http.ts';
import { HttpError } from '../http-error.ts';
import { SkillError, type SkillManager } from '../skills.ts';

function record(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

function required(value: unknown, name: string, max = 2000): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `${name} is required`);
  }
  if (value.length > max) throw new HttpError(400, `${name} is too long`);
  return value.trim();
}

function optional(value: unknown, name: string, max = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be a string`);
  if (value.length > max) throw new HttpError(400, `${name} is too long`);
  return value.trim() || undefined;
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${name} must be an array`);
  if (value.length > 200) throw new HttpError(400, `${name} has too many entries`);
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim() === '' || entry.length > 300) {
      throw new HttpError(400, `${name} must contain non-empty strings`);
    }
    return entry.trim();
  });
}

function statusFor(error: SkillError): number {
  return error.code === 'SKILLS_UNAVAILABLE' || error.code === 'SKILLS_UNSUPPORTED_NODE' ? 503 : 400;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof SkillError) {
      const fix = error.fix ? ` (${error.fix})` : '';
      throw new HttpError(statusFor(error), `${error.code}: ${error.message}${fix}`);
    }
    throw error;
  }
}

export function registerSkillRoutes(router: Router, skills: SkillManager): void {
  router.get('/_/agent/api/skills', () => run(() => skills.list()));
  router.get('/_/agent/api/skills/targets', () => run(async () => ({ data: await skills.targets() })));

  router.post('/_/agent/api/skills/resolve', async (_req, body) => {
    const input = record(body);
    const source = required(input.source, 'source');
    const ref = optional(input.ref, 'ref', 300);
    const fullDepth = input.fullDepth === true;
    const includeInternal = input.includeInternal === true;
    return run(() => skills.resolve(source, {
      ...(ref ? { ref } : {}),
      ...(fullDepth ? { fullDepth } : {}),
      ...(includeInternal ? { includeInternal } : {}),
    }));
  });

  router.post('/_/agent/api/skills/install', async (_req, body) => {
    const input = record(body);
    const token = required(input.token, 'token', 200);
    const names = stringList(input.skills, 'skills');
    const agents = input.agents === undefined ? undefined : stringList(input.agents, 'agents');
    if (agents && agents.length === 0) throw new HttpError(400, 'agents must not be empty');
    return run(() => skills.install(token, names, agents));
  });

  router.post('/_/agent/api/skills/remove', async (_req, body) => {
    const input = record(body);
    const name = required(input.name, 'name', 300);
    const agents = input.agents === undefined ? undefined : stringList(input.agents, 'agents');
    return run(() => skills.remove(name, agents));
  });

  router.post('/_/agent/api/skills/dispose', async (_req, body) => {
    const input = record(body);
    const token = required(input.token, 'token', 200);
    return run(async () => ({ disposed: await skills.dispose(token) }));
  });
}
