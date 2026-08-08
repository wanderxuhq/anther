// server/write-gate.ts
import { HttpError } from './http-error.ts';

/**
 * 写入权限 = 双条件：启动参数 --rw 是必要前提；请求 ro=0 是充分条件。
 * 前端按钮只改 URL ro 参数，服务端这里才是最终裁决者。
 */
export class WriteGate {
  constructor(private allowWrites: boolean) {}

  assertWritable(ro?: string): void {
    if (!this.allowWrites) {
      throw new HttpError(403, '服务器为只读模式（以 --rw 启动以允许写入）');
    }
    if (ro !== '0') {
      throw new HttpError(403, '当前为只读模式（切换编辑模式后再写入）');
    }
  }
}
