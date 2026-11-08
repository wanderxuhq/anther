// server/host.ts
// 监听地址的判定与校验：CLI（--host）和运行时切换接口共用同一套规则。

/** 通配监听地址：0.0.0.0（IPv4）/ ::（双栈 IPv6+IPv4）。 */
export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

/** 仅本机可访问的回环地址。 */
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/** 只接受裸地址（IPv4/IPv6/主机名），不接受 http:// 之类的 URL。 */
export function isValidHost(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('-')
    && /^[0-9A-Za-z.:[\]_-]+$/.test(value);
}
