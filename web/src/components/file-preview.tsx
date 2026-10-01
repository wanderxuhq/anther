import { createSignal, ErrorBoundary, lazy, onCleanup, Show, Suspense, Switch, Match } from 'solid-js';
import type { FileInfo } from '../api.ts';
import { t } from '../i18n.ts';
import './file-preview.css';

const PdfPreview = lazy(() => import('./pdf-preview.tsx'));

export type PreviewFile = FileInfo & { path: string; url: string };

export function FilePreview(props: { file: PreviewFile }) {
  let media: HTMLMediaElement | undefined;
  const [error, setError] = createSignal('');
  const failed = () => setError(t('preview.mediaError'));
  onCleanup(() => {
    // 切换标签后停止播放和后台流量。
    if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  });
  return (
    <section class={`file-preview file-preview-${props.file.kind}`} aria-label={props.file.path}>
      <Show when={error()}><div class="error-banner" role="alert">{error()}</div></Show>
      <Switch>
        <Match when={props.file.kind === 'pdf'}>
          <ErrorBoundary fallback={<div class="error-banner" role="alert">{t('reader.loadFailed')}</div>}>
            <Suspense fallback={<div class="binary-preview" role="status">{t('loading')}</div>}>
              <PdfPreview url={props.file.url} path={props.file.path} />
            </Suspense>
          </ErrorBoundary>
        </Match>
        <Match when={props.file.kind === 'audio' || props.file.kind === 'video'}>
          <div class="media-preview">
            <Show when={props.file.kind === 'video'} fallback={
              <audio ref={(el) => { media = el; }} controls preload="metadata" src={props.file.url} onError={failed} aria-label={props.file.path} />
            }>
              <video ref={(el) => { media = el; }} controls playsinline preload="metadata" src={props.file.url} onError={failed} aria-label={props.file.path} />
            </Show>
          </div>
        </Match>
        <Match when={props.file.kind === 'binary'}>
          <div class="binary-preview">
            <p>{t('preview.unavailable')}</p>

          </div>
        </Match>
      </Switch>
    </section>
  );
}
