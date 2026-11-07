// server/routes/system.ts
import type { Router } from '../http.ts';
import { collectSystemInfo } from '../system.ts';

export function registerSystemRoutes(http: Router, workspaceRoot: string): void {
  http.get('/api/system', async () => collectSystemInfo(workspaceRoot));
}
