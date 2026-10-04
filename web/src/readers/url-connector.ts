import { createEffect, untrack } from 'solid-js';
import { readerRestoreRequest, readingLocationFor, updateReadingLocation } from '../stores.ts';
import type { ReaderFactory, ReaderHost } from './types.ts';

/** App boundary: adapters and the shared reader UI do not import application stores. */
export function createUrlReader(key: string | undefined, factory: ReaderFactory, host: ReaderHost) {
  if (!key) return factory(host);
  const initialRequest = untrack(readerRestoreRequest);
  const reader = factory({ ...host, initialLocation: readingLocationFor(key), onLocation: (location) => updateReadingLocation(key, location) });
  createEffect(() => {
    const request = readerRestoreRequest();
    if (request !== initialRequest && request?.key === key) void reader.restoreLocation?.(request.location);
  });
  return reader;
}
