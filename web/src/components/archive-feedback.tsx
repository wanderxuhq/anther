import { createSignal, Show } from 'solid-js';
import { archiveSession, cancelArchive, ensureArchive } from '../archive-sessions.ts';
import { archiveLimits } from '../archive-settings.ts';
import { t } from '../i18n.ts';
import './archive.css';

export function ArchiveFeedback(props: { path: string; chain?: string[]; retry?: (password?: string) => void }) {
  const state = () => archiveSession(props.path, props.chain);
  const [password, setPassword] = createSignal('');
  const retry = (password?: string) => props.retry ? props.retry(password) : void ensureArchive(props.path, password, true, props.chain).catch(() => {});
  return <div class="archive-feedback">
    <Show when={!state()?.busy && !state()?.entries && !state()?.error && !state()?.passwordRequired}>
      <button class="menu-item" onClick={() => retry()}>{t('archive.retry')}</button>
    </Show>
    <Show when={state()?.busy}>
      <div class="archive-progress" role="status">
        <span>{t(`archive.${state()?.busy}`)}{state()?.progress !== undefined ? ` ${state()!.progress}%` : ''}</span>
        <button class="icon-btn" title={t('archive.cancel')} aria-label={t('archive.cancel')} onClick={() => cancelArchive(props.path)}>×</button>
      </div>
    </Show>
    <Show when={state()?.passwordRequired} fallback={<Show when={state()?.error}>
      <div class="error-banner" role="alert">{state()?.limit === 'depth' ? t('archive.depthLimit', { depth: archiveLimits().maxDepth }) : state()?.limit === 'budget' ? t('archive.budgetLimit', { size: archiveLimits().maxBufferedBytes / 1024 / 1024 }) : t('archive.failed')}<button class="icon-btn" title={t('archive.retry')} aria-label={t('archive.retry')} onClick={() => retry()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5" /></svg>
      </button></div>
    </Show>}>
      <form class="archive-password" onSubmit={(e) => { e.preventDefault(); const value = password(); setPassword(''); retry(value); }}>
        <label>{t('archive.password')}<input type="password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="off" /></label>
        <button type="submit">{t('archive.unlock')}</button>
      </form>
    </Show>
  </div>;
}
