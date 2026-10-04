import { createEffect, createSignal, untrack } from 'solid-js';
import { readerRestoreRequest, readingLocationFor, updateReadingLocation } from './stores.ts';
import type { ReadingLocation } from './readers/location.ts';

/** Only external navigation updates the input; view notifications do not feed back into it. */
export function usePreviewLocation(key: string) {
  const [location, setLocation] = createSignal(readingLocationFor(key));
  const initial = untrack(readerRestoreRequest);
  createEffect(() => { const request = readerRestoreRequest(); if (request !== initial && request?.key === key) setLocation(request.location); });
  return { location, update: (value: ReadingLocation) => updateReadingLocation(key, value) };
}
