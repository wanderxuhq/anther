// web/src/mount-list.ts
// 多工作区实例列表的纯函数：URL 选择、当前实例判断、显示名。
export type MountInfo = {
  name: string;
  index: number;
  workspace: string;
  base: string;
  shorthand: string | null;
  legacyRoot: boolean;
};

/** 实例入口优先使用最短地址：宿主根 `/`，index 0 简写，否则规范地址。 */
export function mountHref(mount: MountInfo): string {
  if (mount.legacyRoot) return '/';
  return `${mount.shorthand ?? mount.base}/`;
}

/** `/-`（含 `/-/`）是实例列表页，不是工作区文件路径。 */
export function isInstancesPath(pathname: string): boolean {
  return pathname === '/-' || pathname === '/-/';
}

/** 当前页面 base 属于该实例（根、简写、规范地址都算）。 */
export function isCurrentMount(mount: MountInfo, base: string): boolean {
  if (mount.legacyRoot && base === '') return true;
  return base === mount.shorthand || base === mount.base;
}

/** 同名 basename 的多个实例用 #index 区分；index 0 不显示后缀。 */
export function mountLabel(mount: MountInfo): string {
  return mount.index > 0 ? `${mount.name} #${mount.index}` : mount.name;
}
