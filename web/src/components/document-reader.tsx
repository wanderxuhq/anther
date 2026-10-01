import { createEffect, createSignal, createUniqueId, on, onCleanup, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { initialReaderState, type ReaderController, type ReaderFactory } from '../readers/types.ts';
import { t } from '../i18n.ts';
import './document-reader.css';
import { bindReaderGestures } from './reader-gestures.ts';
import { ReaderOutline } from './reader-outline.tsx';

/** Shared reader UI. Document formats supply data, rendering and navigation through an adapter. */
export function DocumentReader(props: { url: string; path: string; createReader: ReaderFactory }) {
  let viewport!: HTMLDivElement, content!: HTMLDivElement;
  let reader: ReaderController | undefined;
  const [state, setState] = createStore(initialReaderState());
  const [password, setPassword] = createSignal('');
  const passwordId = createUniqueId();
  const outlineId = createUniqueId();
  const [outlineOpen, setOutlineOpen] = createSignal(false);
  let outlineButton: HTMLButtonElement | undefined;
  const closeOutline = (navigated = false) => {
    setOutlineOpen(false);
    (navigated ? viewport : outlineButton)?.focus({ preventScroll: true });
  };
  createEffect(() => {
    if (!outlineOpen()) return;
    const outside = (event: PointerEvent) => {
      const popup = document.getElementById(outlineId);
      if (!popup?.contains(event.target as Node) && !outlineButton?.contains(event.target as Node)) setOutlineOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeOutline(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    onCleanup(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); });
  });
  createEffect(on([() => props.url, () => props.path, () => props.createReader], () => {
    setOutlineOpen(false); setState(initialReaderState()); setPassword('');
    let active = true;
    reader = props.createReader({ url: props.url, path: props.path, viewport, content,
      onState: (update) => { if (active) setState(update); },
    });
    const instance = reader;
    const unbindGestures = bindReaderGestures(viewport, content, instance, () => state);
    onCleanup(() => { active = false; unbindGestures(); instance.destroy(); reader = undefined; });
  }));
  return (
    <div class="document-reader">
      <div class="reader-toolbar" role="toolbar" aria-label={t('reader.controls')}>
        <button ref={outlineButton} class="icon-btn reader-outline-toggle" title={t('reader.outline')} aria-label={t('reader.outline')}
          aria-haspopup="dialog" aria-expanded={outlineOpen()} aria-controls={outlineId} onClick={() => setOutlineOpen((value) => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M8 10h12M8 15h12M4 20h16M3 10h1M3 15h1"/></svg>
        </button>
        <button class="icon-btn" title={t('reader.previous')} aria-label={t('reader.previous')} disabled={!state.total || state.position <= 1} onClick={() => reader?.goTo(state.position - 1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <input class="reader-page-number" type="number" min="1" max={state.total ?? 1} value={state.position} aria-label={t('reader.page')} disabled={!state.total} onChange={(e) => { reader?.goTo(e.currentTarget.valueAsNumber); e.currentTarget.value = String(state.position); }} />
        <span class="reader-page-count">/ {state.total ?? '—'}</span>
        <button class="icon-btn" title={t('reader.next')} aria-label={t('reader.next')} disabled={!state.total || state.position >= (state.total ?? 1)} onClick={() => reader?.goTo(state.position + 1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </button>
        <Show when={state.canZoom}>
          <button class="icon-btn" title={t('image.zoomOut')} aria-label={t('image.zoomOut')} disabled={!state.total || state.scale <= 0.1} onClick={() => reader?.zoomTo(state.scale / 1.25)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <output>{Math.round(state.scale * 100)}%</output>
          <button class="icon-btn" title={t('image.zoomIn')} aria-label={t('image.zoomIn')} disabled={!state.total || state.scale >= 5} onClick={() => reader?.zoomTo(state.scale * 1.25)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
          </button>
        </Show>
        <Show when={state.canFitWidth}>
          <button class="icon-btn" title={t('reader.fit')} aria-label={t('reader.fit')} aria-pressed={state.fitWidth} disabled={!state.total} onClick={() => reader?.fitWidth()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14M21 5v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3" /></svg>
          </button>
        </Show>
        <Show when={outlineOpen()}><ReaderOutline id={outlineId} state={state} navigate={(id) => reader?.goToOutline?.(id)} close={closeOutline}/></Show>
      </div>
      <Show when={state.password}>
        <form class="reader-password" onSubmit={(e) => { e.preventDefault(); const value = password(); setPassword(''); reader?.unlock(value); }}>
          <label for={passwordId}>{t(state.password === 'incorrect' ? 'reader.wrongPassword' : 'reader.passwordRequired')}</label>
          <input id={passwordId} type="password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="off" />
          <button type="submit">{t('reader.unlock')}</button>
        </form>
      </Show>
      <Show when={state.error}><div class="error-banner" role="alert">{t('reader.loadFailed')}</div></Show>
      <div class="reader-reading-area">
        <Show when={state.busy}><div class="reader-status" role="status">{t('loading')}</div></Show>
        <div class="reader-viewport" classList={{ 'pinch-enabled': state.canZoom && !!state.total }} ref={viewport} tabIndex={0} aria-label={props.path} aria-busy={state.busy}>
          <div class="reader-stage" ref={content} />
        </div>
      </div>
    </div>
  );
}
