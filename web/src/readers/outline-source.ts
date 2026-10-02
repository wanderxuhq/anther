import type { ReaderOutlineItem, ReaderState } from './types.ts';

/** Outline data only: no DOM, reader controls, file tree, or format-specific objects. */
export type OutlineState = {
  outline: ReaderOutlineItem[];
  outlineStatus: ReaderState['outlineStatus'];
  password: ReaderState['password'];
};
export type OutlineSource = {
  subscribe(listener: (state: OutlineState) => void): () => void;
  release(): void;
};
export type OutlineSourceFactory = (url: string) => OutlineSource;
