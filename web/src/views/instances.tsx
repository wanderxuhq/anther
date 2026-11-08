// web/src/views/instances.tsx
// `/-` 独立实例列表页：直接可访问、可分享；点击进入对应实例的最短地址。
// 关闭（detach）采用两击确认：第一击高亮，第二击真正卸载。
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { api } from '../api.ts';
import { t } from '../i18n.ts';
import { mountHref, mountLabel, type MountInfo } from '../mount-list.ts';
import { Icon } from '../components/icons.tsx';

export function InstancesPage() {
  const [mounts, setMounts] = createSignal<MountInfo[] | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [detachError, setDetachError] = createSignal<string | null>(null);
  const [armed, setArmed] = createSignal<string | null>(null);
  const [detaching, setDetaching] = createSignal<string | null>(null);
  let cancelled = false;

  async function load(): Promise<void> {
    setLoading(true);
    setLoadError(null);
    setDetachError(null);
    setArmed(null);
    try {
      const data = await api.anther();
      const sorted = [...(data.mounts ?? [])].sort((a, b) => {
        if (a.legacyRoot !== b.legacyRoot) return a.legacyRoot ? -1 : 1;
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        return a.index - b.index;
      });
      if (!cancelled) setMounts(sorted);
    } catch (e) {
      if (!cancelled) setLoadError((e as Error).message);
    } finally {
      if (!cancelled) setLoading(false);
    }
  }

  onMount(() => { void load(); });
  onCleanup(() => { cancelled = true; });

  async function detach(mount: MountInfo): Promise<void> {
    if (armed() !== mount.base) {
      setDetachError(null);
      setArmed(mount.base);
      return;
    }
    setArmed(null);
    setDetachError(null);
    setDetaching(mount.base);
    try {
      await api.detach(mount.workspace);
      // 服务端返回 detached:null 也表示已经不在挂载表里；两种情况都移除当前行。
      setMounts((prev) => prev?.filter((item) => item.base !== mount.base) ?? prev);
    } catch (e) {
      setDetachError((e as Error).message);
    } finally {
      setDetaching(null);
    }
  }

  const detachLabel = (mount: MountInfo): string => {
    if (detaching() === mount.base) return t('instances.detaching');
    return armed() === mount.base ? t('instances.detachConfirm') : t('instances.detach');
  };

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
        <Show when={loadError()}>
          <div class="error-banner">{t('instances.failed', { msg: loadError()! })}</div>
        </Show>
        <Show when={detachError()}>
          <div class="error-banner">{t('instances.detachFailed', { msg: detachError()! })}</div>
        </Show>

        <Show when={mounts()}>
          {(list) => (
            <Show
              when={list().length > 0}
              fallback={<div class="instances-status">{t('instances.empty')}</div>}
            >
              <div class="instances-list">
                <For each={list()}>{(mount) => (
                  <div class="instance-row">
                    <a class="instance-link" href={mountHref(mount)}>
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
                    <button
                      type="button"
                      class="instance-detach"
                      classList={{ armed: armed() === mount.base }}
                      title={detachLabel(mount)}
                      aria-label={detachLabel(mount)}
                      aria-pressed={armed() === mount.base}
                      aria-busy={detaching() === mount.base}
                      disabled={detaching() === mount.base}
                      onClick={() => void detach(mount)}
                    >
                      <Icon name={detaching() === mount.base ? 'refresh' : 'close'} size={16} />
                    </button>
                  </div>
                )}</For>
              </div>
            </Show>
          )}
        </Show>
      </section>
    </main>
  );
}
