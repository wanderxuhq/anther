import { createSignal } from 'solid-js';
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './archive.ts';

const key = 'anther:archiveLimits';
export function validArchiveLimits(value: ArchiveLimits): boolean {
  return Number.isInteger(value.maxDepth) && value.maxDepth >= 1 && value.maxDepth <= 16
    && Number.isSafeInteger(value.maxBufferedBytes) && value.maxBufferedBytes >= 16 * 1024 * 1024 && value.maxBufferedBytes <= 1024 * 1024 * 1024;
}
function initial(): ArchiveLimits {
  try { const value = JSON.parse(localStorage.getItem(key) ?? 'null'); if (value && validArchiveLimits(value)) return value; } catch { /* Use conservative defaults. */ }
  return DEFAULT_ARCHIVE_LIMITS;
}
export const [archiveLimits, setArchiveLimits] = createSignal(initial());
export function saveArchiveLimits(value: ArchiveLimits) {
  if (!validArchiveLimits(value)) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Session-only settings still work. */ }
  setArchiveLimits(value);
}
