// server/mounts.ts
// 挂载表：宿主自己 + 通过命令行附加的工作区。只存在内存中，宿主退出即消失。
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { Router, type HttpServer } from './http.ts';
import { createWorkspace, registerWorkspaceRoutes, type Workspace } from './workspace.ts';
import type { AttachInfo, IdentityProviders, MountWire } from './mount-types.ts';

export type Mount = {
  name: string;
  index: number;
  /** 规范绝对路径（realpath 后）。 */
  workspace: string;
  /** 规范地址：/-/<name>/-/<index> */
  base: string;
  /** index 0 的简写：/-/<name>；index > 0 为 null。 */
  shorthand: string | null;
  legacyRoot: boolean;
  router: Router;
  context: Workspace;
};

export type AttachResult = {
  existing: boolean;
  mount: MountWire;
};

/** realpath 失败（路径尚不存在等）时退回 path.resolve，便于给出一致的错误路径。 */
export async function canonicalDir(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

/** Windows 下 path.relative 按平台规则做大小写不敏感比较；POSIX 下精确比较。 */
export function isSameWorkspace(a: string, b: string): boolean {
  return path.relative(a, b) === '';
}

export class MountRegistry {
  private mounts: Mount[] = [];
  private nextIndex = new Map<string, number>();

  constructor(
    private readonly http: HttpServer,
    private readonly getAttach: () => AttachInfo,
  ) {}

  providers(): IdentityProviders {
    return {
      getMounts: () => this.listWire(),
      getAttach: this.getAttach,
    };
  }

  listWire(): MountWire[] {
    return this.mounts.map((mount) => this.wire(mount));
  }

  /** 宿主自己：index 0，同时保留 /xxx。 */
  async addHost(dir: string, context: Workspace): Promise<Mount> {
    const workspace = await canonicalDir(dir);
    return this.add(workspace, context, this.http, true);
  }

  /** 命令行附加：同目录已在表中则复用，否则创建新上下文和新 index。 */
  async attach(dir: string): Promise<AttachResult> {
    if (typeof dir !== 'string' || dir === '') throw new Error('missing workspace');
    const workspace = await canonicalDir(dir);
    const info = await stat(workspace).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`not a directory: ${workspace}`);

    const existing = this.mounts.find((mount) => isSameWorkspace(mount.workspace, workspace));
    if (existing) return { existing: true, mount: this.wire(existing) };

    const context = createWorkspace(workspace);
    const router = new Router();
    registerWorkspaceRoutes(router, context, this.providers());
    const mount = this.add(workspace, context, router, false);
    return { existing: false, mount: this.wire(mount) };
  }

  private add(workspace: string, context: Workspace, router: Router, legacyRoot: boolean): Mount {
    const name = path.basename(workspace) || 'root';
    const index = this.nextIndex.get(name) ?? 0;
    const encoded = encodeURIComponent(name);
    const base = `/-/${encoded}/-/${index}`;
    const shorthand = index === 0 ? `/-/${encoded}` : null;
    this.http.mount(shorthand ? [shorthand, base] : [base], router);
    this.nextIndex.set(name, index + 1);

    const mount: Mount = { name, index, workspace, base, shorthand, legacyRoot, router, context };
    this.mounts.push(mount);
    return mount;
  }

  private wire(mount: Mount): MountWire {
    return {
      name: mount.name,
      index: mount.index,
      workspace: mount.workspace,
      base: mount.base,
      shorthand: mount.shorthand,
      legacyRoot: mount.legacyRoot,
    };
  }
}
