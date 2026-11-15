import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import { archiveSession, cancelArchive, ensureArchive } from '../archive-sessions.ts';
import { archiveLimits } from '../archive-settings.ts';
import { visibleFeedbackHostId, type FeedbackHost } from './archive-feedback-model.ts';
import { t } from '../i18n.ts';
import { Icon } from './icons.tsx';
import './archive.css';

const [hosts, setHosts] = createSignal<FeedbackHost[]>([]);
let nextHost = 0;
const session = (host: FeedbackHost) => archiveSession(host.path, host.chain);

/** Multiple surfaces may observe a session, but only one owns its feedback/retry UI. */
export function ArchiveFeedback(props: { path: string; chain?: string[]; entry?: string | null; priority?: number; retry?: (password?: string) => void }) {
  const id = ++nextHost;
  const state = () => archiveSession(props.path, props.chain);
  const snapshot = (): FeedbackHost => ({
    id,
    path: props.path,
    chain: props.chain ?? [],
    entry: props.entry ?? undefined,
    priority: props.priority ?? 0,
  });
  onMount(() => {
    setHosts((items) => [...items, snapshot()]);
    onCleanup(() => setHosts((items) => items.filter((item) => item.id !== id)));
  });
  // Props can change without remounting this component (for example when the
  // active archive/entry changes), so refresh the existing host, never re-add it.
  createEffect(on(() => [props.path, props.chain, props.entry, props.priority], () => {
    const host = snapshot();
    setHosts((items) => items.map((item) => item.id === id ? host : item));
  }, { defer: true }));
  const visible = createMemo(() => visibleFeedbackHostId(hosts(), id, session) === id);
  const [password, setPassword] = createSignal('');
  const retry = (password?: string) => props.retry ? props.retry(password) : void ensureArchive(props.path, password, true, props.chain).catch(() => {});
  return <Show when={visible()}><div class="archive-feedback">
    <Show when={!state()?.busy && !state()?.entries && !state()?.error && !state()?.passwordRequired}>
      <button class="menu-item" onClick={() => retry()}>{t('archive.retry')}</button>
    </Show>
    <Show when={state()?.busy}>
      <div class="archive-progress" role="status">
        <span>{t(`archive.${state()?.busy}`)}{state()?.progress !== undefined ? ` ${state()!.progress}%` : ''}</span>
        <button class="icon-btn" title={t('archive.cancel')} aria-label={t('archive.cancel')} onClick={() => cancelArchive(props.path)}><Icon name="close" size={18} /></button>
      </div>
    </Show>
    <Show when={state()?.passwordRequired} fallback={<Show when={state()?.error}>
      <div class="error-banner" role="alert">{state()?.limit === 'depth' ? t('archive.depthLimit', { depth: archiveLimits().maxDepth }) : state()?.limit === 'budget' ? t('archive.budgetLimit', { size: archiveLimits().maxBufferedBytes / 1024 / 1024 }) : t('archive.failed')}<button class="icon-btn" title={t('archive.retry')} aria-label={t('archive.retry')} onClick={() => retry()}>
        <Icon name="refresh" size={18} />
      </button></div>
    </Show>}>
      <form class="archive-password" onSubmit={(e) => { e.preventDefault(); const value = password(); setPassword(''); retry(value); }}>
        <label>{t('archive.password')}<input type="password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="off" /></label>
        <button type="submit">{t('archive.unlock')}</button>
      </form>
    </Show>
  </div></Show>;
}
