// server/write-gate.ts
import { HttpError } from './http-error.ts';

/**
 * 写入校验：服务端始终接受写请求（无需启动参数），
 * 请求携带 ro=0（前端编辑模式）即放行；ro=1 或缺省 → 403。
 * 用户决策 2026-08-08：移除 --rw 启动必要条件，写入仅由请求级 ro 裁决。
 */
export function assertWritable(ro?: string): void {
  if (ro !== '0') {
    throw new HttpError(403, '当前为只读模式（切换编辑模式后再写入）');
  }
}
