import { createSignal, Show } from 'solid-js';
import { archiveLimits, saveArchiveLimits, validArchiveLimits } from '../archive-settings.ts';
import { closeArchives } from '../archive-sessions.ts';
import { t } from '../i18n.ts';

export function ArchiveOptions() {
  const [open, setOpen] = createSignal(false);
  const [depth, setDepth] = createSignal(3), [size, setSize] = createSignal(128);
  return <>
    <button class="icon-btn" title={t('archive.settings')} aria-label={t('archive.settings')} onClick={() => {
      setDepth(archiveLimits().maxDepth); setSize(archiveLimits().maxBufferedBytes / 1024 / 1024); setOpen(true);
    }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6"/></svg></button>
    <Show when={open()}>
      <div class="dialog-backdrop" onClick={() => setOpen(false)}>
        <form class="dialog-card archive-options" role="dialog" aria-modal="true" aria-label={t('archive.settings')} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} onSubmit={(e) => {
          e.preventDefault(); const value = { maxDepth: depth(), maxBufferedBytes: size() * 1024 * 1024 };
          if (!validArchiveLimits(value)) return;
          closeArchives(); saveArchiveLimits(value); setOpen(false);
        }}>
          <h3>{t('archive.settings')}</h3>
          <label>{t('archive.depthSetting')}<input autofocus type="number" min="1" max="16" required value={depth()} onInput={(e) => setDepth(e.currentTarget.valueAsNumber)}/></label>
          <label>{t('archive.budgetSetting')}<input type="number" min="16" max="1024" required value={size()} onInput={(e) => setSize(e.currentTarget.valueAsNumber)}/></label>
          <p>{t('archive.budgetHint')}</p>
          <div class="dialog-actions"><button type="button" onClick={() => setOpen(false)}>{t('cancel')}</button><button type="submit">{t('archive.apply')}</button></div>
        </form>
      </div>
    </Show>
  </>;
}
