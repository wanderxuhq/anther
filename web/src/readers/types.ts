/** Format-neutral contract; no PDF.js or view framework types cross this boundary. */
export type ReaderOutlineItem = { id: string; title: string; navigable: boolean; children: ReaderOutlineItem[] };
export type ReaderState = {
  position: number;
  total: number | null;
  scale: number;
  fitWidth: boolean;
  busy: boolean;
  error: 'loadFailed' | null;
  password: 'required' | 'incorrect' | null;
  canZoom: boolean;
  canFitWidth: boolean;
  outline: ReaderOutlineItem[];
  outlineStatus: 'unavailable' | 'loading' | 'ready' | 'error';
};
export const initialReaderState = (): ReaderState => ({
  position: 1, total: null, scale: 1, fitWidth: true, busy: true,
  error: null, password: null, canZoom: false, canFitWidth: false, outline: [], outlineStatus: 'unavailable',
});
export type ReaderZoomOptions = {
  /** Coordinates relative to the reading viewport, in CSS pixels. */
  origin?: { x: number; y: number };
  pan?: { x: number; y: number };
};
export type ReaderController = {
  goTo(position: number): void;
  goToOutline?(id: string): void | Promise<void>;
  zoomTo(scale: number, options?: ReaderZoomOptions): void;
  fitWidth(): void;
  unlock(password: string): void;
  destroy(): void;
};
export type ReaderHost = {
  url: string;
  path: string;
  viewport: HTMLDivElement;
  content: HTMLDivElement;
  onState(update: Partial<ReaderState>): void;
};
export type ReaderFactory = (host: ReaderHost) => ReaderController;
