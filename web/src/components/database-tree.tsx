import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { createSqliteSource } from '../database/sqlite-source.ts';
import type { DatabaseObject } from '../database/source.ts';
import { activeTab, openDatabaseTab } from '../stores.ts';
import { DatabaseIcon } from './database-icon.tsx';
import { t } from '../i18n.ts';
import './database.css';

export default function DatabaseTree(props: { path: string }) {
  const [objects, setObjects] = createSignal<DatabaseObject[]>([]);
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal(''), [truncated, setTruncated] = createSignal(false);
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    tick();
    const source = createSqliteSource(props.path);
    let active = true;
    setBusy(true); setError('');
    source.listObjects().then((result) => { if (active) { setObjects(result.objects); setTruncated(result.truncated); } })
      .catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    onCleanup(() => { active = false; source.dispose(); });
  });
  return <div class="tree-children database-tree">
    <Show when={busy()}><div class="view-placeholder" role="status">{t('loading')}</div></Show>
    <Show when={error()}><div class="error-banner" role="alert">{error()}</div></Show>
    <Show when={!busy()}>
      <For each={['table', 'view'] as const}>{(kind) => {
        const [expanded, setExpanded] = createSignal(true), [limit, setLimit] = createSignal(100);
        const group = () => objects().filter((item) => item.type === kind);
        return <Show when={group().length}>
          <button class="tree-row database-group" onClick={() => setExpanded(!expanded())} aria-expanded={expanded()}>
            <span class="tree-arrow">{expanded() ? '▾' : '▸'}</span><DatabaseIcon kind={kind}/><span>{t(`database.${kind}s`)}</span>
          </button>
          <Show when={expanded()}><div class="tree-children"><For each={group().slice(0, limit())}>{(object) => {
            const selected = () => { const tab = activeTab(); return tab?.kind === 'database' && tab.path === props.path && tab.object?.name === object.name && tab.object.type === kind; };
            return <button class={`tree-row database-object ${selected() ? 'active' : ''}`} title={object.name}
              onClick={() => openDatabaseTab(props.path, { object, mode: 'data' })}>
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
