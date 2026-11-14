// web/src/views/feature.tsx
// Generic optional-feature canvas: anther owns the container/lifecycle, the
// feature package owns everything inside the canvas.
import { createEffect, createSignal, on, onCleanup, Show, untrack } from 'solid-js';
import type {
  FeaturePanel,
  FeatureTabPatch,
  FeatureTabsState,
  FeatureToolbarAction,
} from '../feature-types.ts';
import { loadFeatureUi, type FeatureUiHandle } from '../features.ts';
import { basePath } from '../base.ts';
import { theme } from '../stores.ts';
import { lang, t } from '../i18n.ts';

export function FeatureView(props: {
  panel: FeaturePanel;
  path: string;
  onTabs?: (state: FeatureTabsState) => void;
  onToolbar?: (actions: FeatureToolbarAction[]) => void;
  onOpenPath?: (path: string, patch?: FeatureTabPatch) => void;
  onClosePath?: (path: string) => void;
  onUpdateTab?: (path: string, patch: FeatureTabPatch) => void;
}) {
  let host!: HTMLDivElement;
  const [handle, setHandle] = createSignal<FeatureUiHandle | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);

  createEffect(on(() => props.panel.ui, () => {
    const panel = props.panel;
    let cancelled = false;
    let current: FeatureUiHandle | undefined;
    setError(null);
    setReady(false);

    const load = panel.builtin === 'agent'
      ? import('../agent/ui.tsx').then((mod) => ({ mount: mod.mount }))
      : loadFeatureUi(panel.ui);
    void load.then((mod) => {
      if (cancelled) return;
      current = mod.mount(host, {
        base: basePath(),
        theme: untrack(theme),
        lang: untrack(lang),
        path: props.path,
        onTabs: (state) => props.onTabs?.(state),
        onToolbar: (actions) => props.onToolbar?.(actions),
        onOpenPath: (path, patch) => props.onOpenPath?.(path, patch),
        onClosePath: (path) => props.onClosePath?.(path),
        onUpdateTab: (path, patch) => props.onUpdateTab?.(path, patch),
      });
      setHandle(current);
      setReady(true);
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    onCleanup(() => {
      cancelled = true;
      current?.dispose();
      setHandle(null);
      props.onToolbar?.([]);
    });
  }, { defer: false }));

  // Theme/language/subpath changes update the canvas; they do not remount it.
  createEffect(() => {
    const current = handle();
    current?.update?.({ theme: theme(), lang: lang(), path: props.path });
  });

  return (
    <div class="feature-host">
      <div ref={host} class="feature-canvas" />
      <Show when={!ready() && !error()}>
        <div class="view-placeholder" role="status">{t('feature.loading', { title: props.panel.title })}</div>
      </Show>
      <Show when={error()}>
        {(message) => (
          <div class="view-placeholder">
            {t('feature.loadError', { title: props.panel.title, msg: message() })}
          </div>
        )}
      </Show>
    </div>
  );
}
