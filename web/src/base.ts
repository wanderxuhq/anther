// web/src/base.ts
// 挂载 base：由服务端在 index.html 注入 window.__ANTHER_BASE__（如 "/-/qlang"）。
// 根路径不注入，默认空串，保持既有行为。开发模式 Vite 直接提供前端，默认空串。

function normalize(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value === '/') return '';
  if (!value.startsWith('/') || value.startsWith('//')) return '';
  return value.replace(/\/+$/, '');
}

let current = normalize(
  (globalThis as unknown as { __ANTHER_BASE__?: unknown }).__ANTHER_BASE__,
);

export function setBasePath(value: unknown): void {
  current = normalize(value);
}

export function basePath(): string {
  return current;
}

/** 给站内绝对路径加 base；完整 URL / 协议相对 URL 原样返回，避免重复前缀。 */
export function withBase(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  if (!current) return path;
  if (path === current || path.startsWith(`${current}/`)) return path;
  return `${current}${path}`;
}
