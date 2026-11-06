// web/src/components/system-info.tsx
// 服务器信息对话框：点击后现取 /api/system，展示主机、硬件、磁盘、运行时长与版本。
// 可刷新；Esc / 点遮罩 / 关闭按钮退出。
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { api, type SystemInfo } from '../api.ts';
import { t } from '../i18n.ts';
import { formatBytes, formatLoad, formatUptime, usedBytes } from '../system-info-model.ts';

export function SystemInfoDialog(props: { onClose: () => void }) {
  const [info, setInfo] = createSignal<SystemInfo | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  let cancelled = false;

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const data = await api.system();
      if (!cancelled) setInfo(data);
    } catch (e) {
      if (!cancelled) setError((e as Error).message);
    } finally {
      if (!cancelled) setLoading(false);
    }
  }

  onMount(() => {
    void load();
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      cancelled = true;
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  const durationLabels = () => ({
    day: t('system.day'), hour: t('system.hour'), minute: t('system.minute'), second: t('system.second'),
  });

  const usage = (total: number, free: number) => t('system.usage', {
    used: formatBytes(usedBytes(total, free)),
    total: formatBytes(total),
    free: formatBytes(free),
  });

  return (
    <div class="dialog-backdrop" onClick={props.onClose}>
      <div
        class="dialog-card system-info-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="system-info-head">
          <h2 class="dialog-title" id="system-info-title">{t('system.title')}</h2>
          <button type="button" class="icon-btn" disabled={loading()} onClick={() => void load()}
            title={t('system.refresh')} aria-label={t('system.refresh')}>↻</button>
          <button type="button" class="icon-btn" onClick={props.onClose}
            title={t('system.close')} aria-label={t('system.close')}>✕</button>
        </div>

        <Show when={loading() && !info()}>
          <div class="system-info-status" role="status">{t('system.loading')}</div>
        </Show>
        <Show when={error()}>
          <div class="error-banner">{t('system.failed', { msg: error()! })}</div>
        </Show>

        <Show when={info()}>
          {(data) => (
            <dl class="system-info-list">
              <div class="system-info-row"><dt>{t('system.address')}</dt><dd>{window.location.origin}</dd></div>
              <div class="system-info-row"><dt>{t('system.hostname')}</dt><dd>{data().hostname}</dd></div>
              <div class="system-info-row"><dt>{t('system.platform')}</dt><dd>{`${data().type} ${data().release}`}</dd></div>
              <div class="system-info-row"><dt>{t('system.arch')}</dt><dd>{data().arch}</dd></div>
              <div class="system-info-row">
                <dt>{t('system.cpu')}</dt>
                <dd>{t('system.cpuValue', { model: data().cpuModel, count: data().cpuCount })}</dd>
              </div>
              <div class="system-info-row"><dt>{t('system.load')}</dt><dd>{formatLoad(data().loadavg)}</dd></div>
              <div class="system-info-row">
                <dt>{t('system.memory')}</dt>
                <dd>{usage(data().totalMem, data().freeMem)}</dd>
              </div>
              <div class="system-info-row">
                <dt>{t('system.disk')}</dt>
                <dd>{data().disk ? usage(data().disk!.total, data().disk!.free) : t('system.unavailable')}</dd>
              </div>
              <div class="system-info-row">
                <dt>{t('system.uptime')}</dt>
                <dd>{formatUptime(data().uptime, durationLabels())}</dd>
              </div>
              <div class="system-info-row">
                <dt>{t('system.processUptime')}</dt>
                <dd>{formatUptime(data().processUptime, durationLabels())}</dd>
              </div>
              <div class="system-info-row"><dt>{t('system.node')}</dt><dd>{data().node}</dd></div>
              <div class="system-info-row"><dt>{t('system.version')}</dt><dd>{data().version}</dd></div>
              <div class="system-info-row"><dt>{t('system.workspace')}</dt><dd>{data().workspace}</dd></div>
            </dl>
          )}
        </Show>

        <div class="dialog-actions">
          <button type="button" class="icon-btn" onClick={props.onClose}>{t('system.close')}</button>
        </div>
      </div>
    </div>
  );
}
