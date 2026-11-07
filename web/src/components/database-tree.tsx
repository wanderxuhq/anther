import { archiveLimits } from '../archive-settings.ts';
import { archiveSession } from '../archive-sessions.ts';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { createDatabaseSource } from '../database/file-source.ts';
import { fileTargetKey, type FileTarget } from '../file-target.ts';
import type { DatabaseObject } from '../database/source.ts';
import { activeTab, openDatabaseTab } from '../stores.ts';
import { DatabaseIcon } from './database-icon.tsx';
import { Icon } from './icons.tsx';
import { t } from '../i18n.ts';
import './database.css';

export default function DatabaseTree(props: FileTarget & { reload?: number }) {
  const [objects, setObjects] = createSignal<DatabaseObject[]>([]);
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal(''), [truncated, setTruncated] = createSignal(false);
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    if (props.archive) archiveLimits();
    const refresh = tick(); props.reload;
    const source = createDatabaseSource({ path: props.path, archive: props.archive });
    if (refresh) source.refresh?.();
    let active = true;
    setBusy(true); setError('');
    source.listObjects().then((result) => { if (active) { setObjects(result.objects); setTruncated(result.truncated); } })
      .catch((e) => { if (active) setError(e.message); }).finally(() => { source.dispose(); if (active) setBusy(false); });
    onCleanup(() => { active = false; source.dispose(); });
  });
  const archiveFailure = createMemo(on(error, (message) => !!props.archive && !!message && archiveSession(props.path, props.archive.chain)?.error === message));
  return <div class="tree-children database-tree">
    <Show when={busy()}><div class="view-placeholder" role="status">{t('loading')}</div></Show>
    <Show when={error() && !archiveFailure()}><div class="error-banner" role="alert">{error()}</div></Show>
    <Show when={!busy()}>
      <For each={['table', 'view'] as const}>{(kind) => {
        const [expanded, setExpanded] = createSignal(true), [limit, setLimit] = createSignal(100);
        const group = () => objects().filter((item) => item.type === kind);
        return <Show when={group().length}>
          <button class="tree-row database-group" onClick={() => setExpanded(!expanded())} aria-expanded={expanded()}>
            <span class="tree-arrow"><Icon name={expanded() ? 'chevron-down' : 'chevron-right'} size={14} /></span><DatabaseIcon kind={kind}/><span>{t(`database.${kind}s`)}</span>
          </button>
          <Show when={expanded()}><div class="tree-children"><For each={group().slice(0, limit())}>{(object) => {
            const selected = () => { const tab = activeTab(); return tab?.kind === 'database' && fileTargetKey(tab) === fileTargetKey(props) && tab.object?.name === object.name && tab.object.type === kind; };
            return <button class={`tree-row database-object ${selected() ? 'active' : ''}`} title={object.name}
              onClick={() => openDatabaseTab(props.path, { object, mode: 'data', archive: props.archive })}>
              <DatabaseIcon kind={kind}/><span class="tree-name">{object.name}</span>
            </button>;
          }}</For>
          <Show when={group().length > limit()}><button class="menu-item" onClick={() => setLimit(limit() + 100)}>{t('archive.more')}</button></Show>
          </div></Show>
        </Show>;
      }}</For>
      <Show when={!objects().length && !error()}><div class="view-placeholder">{t('database.empty')}</div></Show>
      <Show when={truncated()}><div class="view-placeholder">{t('database.objectLimit')}</div></Show>
      <button class="icon-btn" aria-label={t('database.refreshObjects')} title={t('database.refreshObjects')} onClick={() => setTick(tick() + 1)}><DatabaseIcon kind="refresh"/></button>
    </Show>
  </div>;
}
