// server/path-safety.ts
// Pure path-boundary check shared by workspace file access and Git path arguments.
import path from 'node:path';
import { HttpError } from './http-error.ts';

/** Resolve a workspace-relative path and reject lexical escapes with 400. */
export function resolveWithinRoot(root: string, relPath: string): string {
  if (typeof relPath !== 'string' || relPath === '') {
    throw new HttpError(400, 'invalid path');
  }
  const abs = path.resolve(root, relPath);
  const rootAbs = path.resolve(root);
  // root="/" makes rootAbs + path.sep "//"; normalize before the prefix check.
  const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (abs !== rootAbs && !abs.startsWith(prefix)) {
    throw new HttpError(400, 'path escapes root');
  }
  return abs;
}
