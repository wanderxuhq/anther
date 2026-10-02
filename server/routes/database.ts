import type { HttpServer } from '../http.ts';
import type { FileStore } from '../files.ts';
import { HttpError } from '../http-error.ts';
import { SqliteService } from '../sqlite.ts';
import type { DatabaseRequest } from '../database-types.ts';

export function registerDatabaseRoutes(http: HttpServer, files: FileStore) {
  const service = new SqliteService(files);
  http.onClose(() => service.dispose());
  http.getStream('/api/database', async (req, res, query) => {
    if (req.method !== 'GET') throw new HttpError(405, 'GET required');
    const path = query.get('path');
    if (!path) throw new HttpError(400, 'Missing database path');
    let request: DatabaseRequest;
    try { request = JSON.parse(query.get('request') ?? 'null'); }
    catch { throw new HttpError(400, 'Invalid database request'); }
    if (!request || !['objects', 'describe', 'rows'].includes(request.action)) throw new HttpError(400, 'Invalid database request');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once('close', cancel);
    try {
      const result = await service.query(path, request, controller.signal);
      if (!res.destroyed) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(result));
      }
    } finally { res.off('close', cancel); }
  });
  return service;
}
