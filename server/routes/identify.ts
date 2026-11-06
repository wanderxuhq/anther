// server/routes/identify.ts
// 轻量身份接口：客户端可用它确认对面是不是 anther，无需读取文件或系统信息。
// 路径本身带产品名，避免和通用 /identify 之类的接口混淆。
import type { HttpServer } from '../http.ts';
import { appIdentity } from '../app-info.ts';

/** 路径带产品名，探测方一眼可知这是 anther 专属接口。 */
export const IDENTIFY_PATH = '/api/anther';

export function registerIdentifyRoutes(http: HttpServer, workspaceRoot: string): void {
  http.get(IDENTIFY_PATH, async () => appIdentity(workspaceRoot));
}
