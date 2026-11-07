// web/src/views/instances.tsx
// `/-` 独立实例列表页：直接可访问、可分享；点击进入对应实例的最短地址。
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { api } from '../api.ts';
import { t } from '../i18n.ts';
import { mountHref, mountLabel, type MountInfo } from '../mount-list.ts';
import { Icon } from '../components/icons.tsx';

export function InstancesPage() {
  const [mounts, setMounts] = createSignal<MountInfo[] | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  let cancelled = false;

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const data = await api.anther();
      if (!cancelled) setMounts(data.mounts ?? []);
    } catch (e) {
      if (!cancelled) setError((e as Error).message);
    } finally {
      if (!cancelled) setLoading(false);
    }
  }

  onMount(() => { void load(); });
  onCleanup(() => { cancelled = true; });

  return (
    <main class="instances-page">
      <section class="instances-page-card">
        <header class="instances-page-head">
          <h1 class="instances-page-title">{t('instances.title')}</h1>
          <button type="button" class="icon-btn" disabled={loading()} onClick={() => void load()}
            title={t('instances.refresh')} aria-label={t('instances.refresh')}><Icon name="refresh" /></button>
          <a class="icon-btn" href="/" title={t('instances.close')} aria-label={t('instances.close')}><Icon name="close" /></a>
        </header>

        <Show when={loading() && !mounts()}>
          <div class="instances-status" role="status">{t('instances.loading')}</div>
        </Show>
        <Show when={error()}>
          <div class="error-banner">{t('instances.failed', { msg: error()! })}</div>
        </Show>

        <Show when={mounts()}>
          {(list) => (
            <Show
              when={list().length > 0}
              fallback={<div class="instances-status">{t('instances.empty')}</div>}
            >
              <div class="instances-list">
                <For each={list()}>{(mount) => (
                  <a class="instance-row" href={mountHref(mount)}>
                    <span class="instance-main">
                      <span class="instance-title">
                        <span class="instance-name">{mountLabel(mount)}</span>
                        <Show when={mount.legacyRoot}>
                          <span class="instance-badge">{t('instances.host')}</span>
                        </Show>
                      </span>
                      <span class="instance-workspace">{mount.workspace}</span>
                      <span class="instance-url">{mountHref(mount)}</span>
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </a>
                )}</For>
              </div>
            </Show>
          )}
        </Show>
      </section>
    </main>
  );
}
