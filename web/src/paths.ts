// web/src/paths.ts —— 文件树路径纯函数（无 DOM，node:test 可测）
/** 父目录路径：'a/b/c' → 'a/b'；顶层 'a' → '.'（与文件树根键一致） */
export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '.' : path.slice(0, i);
}
/** 新建/重命名名称校验：非空、不含 '/'、非 '.'/'..' */
export function isValidName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/');
}
/** 文件树 reveal 的逐级路径；默认包含末段，定位文件时排除文件名。 */
export function pathSegments(path: string, includeLeaf = true): string[] {
  const parts = path.split('/').filter(Boolean);
  if (!includeLeaf) parts.pop();
  return parts;
}
