// server/routes/system.ts
import type { HttpServer } from '../http.ts';
import { collectSystemInfo } from '../system.ts';

export function registerSystemRoutes(http: HttpServer, workspaceRoot: string): void {
  http.get('/api/system', async () => collectSystemInfo(workspaceRoot));
}
