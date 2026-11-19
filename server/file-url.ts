// server/file-url.ts
// OSC 7 报的是 file:// URL；预览/定位接口需要当前平台的文件系统路径。
// 浏览器端无法知道服务端平台，所以统一在服务端转换。
import os from 'node:os';

/**
 * file:// URL → 本机路径。非 file:// 原样返回（兼容只报普通路径的 shell）。
 *
 * Windows：
 * - `file:///C:/dir` 与 `file://HOST/C:/dir` → `C:\dir`
 * - `file://server/share/dir`（host 不是本机）→ `\\server\share\dir`
 * - cmd 的 `PROMPT` 只做 best-effort，路径可能带反斜杠或空格，URL 解析会规范化。
 *
 * POSIX：只取 pathname，与 `fileURLToPath` 一致（host 被忽略）。
 */
export function fileUrlPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
  hostname: string = os.hostname(),
): string {
  if (!value.startsWith('file://')) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    // 非法百分号编码（例如路径里有裸 `%`）：保留 URL 里的原始形式
    pathname = url.pathname;
  }
  if (platform !== 'win32') return pathname || '/';

  // 盘符路径：本地 shell 报的 file:///C:/... 或 file://HOST/C:/...
  if (/^\/[A-Za-z]:(?:[\\/]|$)/.test(pathname)) {
    return pathname.slice(1).replace(/\//g, '\\');
  }

  const host = url.hostname.toLowerCase();
  if (host && host !== 'localhost' && host !== hostname.toLowerCase()) {
    // 远程/UNC 路径：file://server/share/x → \\server\share\x
    return `\\\\${url.hostname}${pathname.replace(/\//g, '\\')}`;
  }
  // 本机但缺少盘符（例如 UNC 挂载点）：保持绝对形式，由 path.resolve 处理
  return pathname.replace(/\//g, '\\') || '\\';
}
