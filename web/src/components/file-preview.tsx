import { createEffect, createSignal, ErrorBoundary, lazy, onCleanup, Show, Suspense, Switch, Match } from 'solid-js';
import { bindMediaPosition } from '../media-position.ts';
import { usePreviewLocation } from '../preview-location.ts';
import type { FileInfo } from '../api.ts';
import { t } from '../i18n.ts';
import './file-preview.css';

const EpubPreview = lazy(() => import('./epub-preview.tsx'));
const PdfPreview = lazy(() => import('./pdf-preview.tsx'));

export type PreviewFile = FileInfo & { path: string; url: string };

export function FilePreview(props: { file: PreviewFile; navigationKey?: string }) {
  const position = usePreviewLocation(props.navigationKey ?? props.file.path);
  let media: HTMLMediaElement | undefined;
  let binding: ReturnType<typeof bindMediaPosition> | undefined;
  const attach = (element: HTMLMediaElement) => { media = element; binding = bindMediaPosition(element, position.update); const value = position.location(); binding.restore(value?.kind === 'media' ? value : null); };
  createEffect(() => { const value = position.location(); binding?.restore(value?.kind === 'media' ? value : null); });
  const [error, setError] = createSignal('');
  const failed = () => setError(t('preview.mediaError'));
  onCleanup(() => {
    // 切换标签后停止播放和后台流量。
    binding?.dispose(); if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  });
  return (
    <section class={`file-preview file-preview-${props.file.kind}`} aria-label={props.file.path}>
      <Show when={error()}><div class="error-banner" role="alert">{error()}</div></Show>
      <Switch>
        <Match when={props.file.kind === 'pdf' || props.file.kind === 'epub'}>
          <ErrorBoundary fallback={<div class="error-banner" role="alert">{t('reader.loadFailed')}</div>}>
            <Suspense fallback={<div class="binary-preview" role="status">{t('loading')}</div>}>
              <Show when={props.file.kind === 'epub'} fallback={<PdfPreview url={props.file.url} path={props.file.path} navigationKey={props.navigationKey} />}>
                <EpubPreview url={props.file.url} path={props.file.path} navigationKey={props.navigationKey} />
              </Show>
            </Suspense>
          </ErrorBoundary>
        </Match>
        <Match when={props.file.kind === 'audio' || props.file.kind === 'video'}>
          <div class="media-preview">
            <Show when={props.file.kind === 'video'} fallback={
              <audio ref={attach} controls preload="metadata" src={props.file.url} onError={failed} aria-label={props.file.path} />
            }>
              <video ref={attach} controls playsinline preload="metadata" src={props.file.url} onError={failed} aria-label={props.file.path} />
            </Show>
          </div>
        </Match>
        <Match when={props.file.kind === 'binary' || props.file.kind === 'sqlite'}>
          <div class="binary-preview">
            <p>{t('preview.unavailable')}</p>

          </div>
        </Match>
      </Switch>
    </section>
  );
}
