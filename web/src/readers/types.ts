/** Format-neutral contract; no PDF.js or view framework types cross this boundary. */
import type { ReadingLocation } from './location.ts';
export type ReaderOutlineItem = { id: string; title: string; navigable: boolean; children: ReaderOutlineItem[] };
export type ReaderState = {
  unit?: 'page' | 'chapter';
  position: number;
  total: number | null;
  scale: number;
  fitWidth: boolean;
  busy: boolean;
  error: 'loadFailed' | 'unsupported' | null;
  password: 'required' | 'incorrect' | null;
  canZoom: boolean;
  canFitWidth: boolean;
  outline: ReaderOutlineItem[];
  outlineStatus: 'unavailable' | 'loading' | 'ready' | 'error';
};
export const initialReaderState = (): ReaderState => ({
  unit: 'page', position: 1, total: null, scale: 1, fitWidth: true, busy: true,
  error: null, password: null, canZoom: false, canFitWidth: false, outline: [], outlineStatus: 'unavailable',
});
export type ReaderZoomOptions = {
  /** Coordinates relative to the reading viewport, in CSS pixels. */
  origin?: { x: number; y: number };
  pan?: { x: number; y: number };
};
export type ReaderController = {
  restoreLocation?(location: ReadingLocation | null): void | Promise<void>;
  goTo(position: number): void;
  goToOutline?(id: string): void | Promise<void>;
  zoomTo(scale: number, options?: ReaderZoomOptions): void;
  fitWidth(): void;
  unlock(password: string): void;
  destroy(): void;
};
export type ReaderHost = {
  initialLocation?: ReadingLocation | null;
  onLocation?(location: ReadingLocation): void;
  url: string;
  path: string;
  viewport: HTMLDivElement;
  content: HTMLDivElement;
  onState(update: Partial<ReaderState>): void;
};
export type ReaderFactory = (host: ReaderHost) => ReaderController;
