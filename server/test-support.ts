// server/test-support.ts
// Windows 测试辅助。不是 *.test.ts，不会被 npm test 当成测试运行。
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function symlinkPermissionError(e: unknown): boolean {
  return process.platform === 'win32' && (e as NodeJS.ErrnoException)?.code === 'EPERM';
}

let fileSymlinkSupport: boolean | undefined;

/**
 * Windows 未开启开发者模式/未以管理员运行时，普通文件符号链接会 EPERM。
 * 用静态 `{ skip: !canCreateFileSymlink() }` 跳过依赖它的测试：不要在测试体内
 * `t.skip()`，Node 会连 afterEach 一起跳过，导致 HTTP server/临时目录泄漏。
 */
export function canCreateFileSymlink(): boolean {
  if (fileSymlinkSupport !== undefined) return fileSymlinkSupport;
  if (process.platform !== 'win32') return (fileSymlinkSupport = true);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'anther-symlink-probe-'));
  try {
    symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'));
    fileSymlinkSupport = true;
  } catch (e) {
    if (!symlinkPermissionError(e)) throw e;
    fileSymlinkSupport = false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return fileSymlinkSupport;
}

/**
 * 创建符号链接：目录链接在 Windows 上改用 junction（不需要开发者模式/管理员），
 * 普通文件符号链接无权限时返回 false，由调用方决定降级断言。
 */
export async function makeSymlink(
  target: string,
  linkPath: string,
  kind: 'file' | 'dir' = 'file',
): Promise<boolean> {
  if (kind === 'dir' && process.platform === 'win32') {
    // junction 要求绝对目标；相对目标按链接所在目录解析。
    await symlink(path.resolve(path.dirname(linkPath), target), linkPath, 'junction');
    return true;
  }
  try {
    await symlink(target, linkPath, kind);
    return true;
  } catch (e) {
    if (symlinkPermissionError(e)) return false;
    throw e;
  }
}
