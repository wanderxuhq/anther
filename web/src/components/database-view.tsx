import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { TablePosition } from '../preview-state.ts';
import type { DatabaseController, DatabaseState } from '../database/controller.ts';
import type { DatabaseObject, DatabaseCell } from '../database/source.ts';
import { DataTable } from './data-table.tsx';
import { DataGrid } from './data-grid.tsx';
import { t } from '../i18n.ts';
import { Icon } from './icons.tsx';
import './database.css';

const displayCell = (cell: DatabaseCell): string | number | null => {
  if (cell.type === 'blob') return `BLOB (${cell.bytes} B)`;
  if (cell.type === 'text') return cell.value + (cell.truncated ? '…' : '');
  return cell.value;
};

/** Presentation only: independent of SQLite, HTTP, paths, and application tabs. */
export function DatabaseView(props: {
  state: DatabaseState;
  mode: 'data' | 'structure';
  object: DatabaseObject | null;
  controller: Pick<DatabaseController, 'cancel' | 'sort' | 'filter' | 'previous' | 'next'> & { readonly hasPrevious?: boolean };
  position?: TablePosition;
  onPosition?(value: TablePosition): void;
  onOpen(object: DatabaseObject): void;
}) {
  const [filterColumn, setFilterColumn] = createSignal(props.state.filter?.column ?? '');
  const [filterValue, setFilterValue] = createSignal(props.state.filter?.value ?? '');
  createEffect(() => { setFilterColumn(props.state.filter?.column ?? ''); setFilterValue(props.state.filter?.value ?? ''); });
  const hasPrevious = () => { props.state; return props.controller.hasPrevious ?? props.state.pages.length > 1; };
  const sourceRows = createMemo(() => props.state.rows?.rows);
  const rows = createMemo(() => sourceRows()?.map((row) => row.map(displayCell)) ?? []);
  const filterColumns = createMemo<{ key: string; label: string }[]>((previous) => props.state.rows?.columns ?? previous ?? [], [] as { key: string; label: string }[]);
  const showFilter = () => props.mode === 'data' && !!props.object;
  const loading = () => <span class="database-loading-slot"><button type="button" class="icon-btn database-loading" classList={{ active: props.state.busy }} disabled={!props.state.busy}
    onClick={() => props.controller.cancel()} aria-label={`${t('loading')} · ${t('cancel')}`} title={`${t('loading')} · ${t('cancel')}`}><span role="status" aria-label={t('loading')}/></button></span>;
  const previewLimited = () => props.state.rows?.limited || props.state.rows?.rows.some((row) => row.some((cell) => (cell.type === 'text' || cell.type === 'blob') && cell.truncated));
  return <section class="database-view" aria-busy={props.state.busy}>
    <Show when={props.state.error}><div class="error-banner" role="alert">{props.state.error}</div></Show>
    <Show when={!showFilter()}><div class="database-loading-corner">{loading()}</div></Show>
    <Show when={props.state.objects.length}><div class="database-object-list"><For each={props.state.objects}>{(object) =>
      <button class="menu-item" onClick={() => props.onOpen(object)}>{object.name} <small>({t(`database.${object.type}`)})</small></button>
    }</For></div></Show>
    <Show when={!props.state.busy && !props.state.error && !props.state.objects.length && !props.state.description && !props.state.rows}>
      <div class="view-placeholder">{t('database.choose')}</div>
    </Show>
    <Show when={props.state.objectsTruncated}><div class="view-placeholder">{t('database.objectLimit')}</div></Show>
    <Show when={showFilter()}>
      <form class="database-filter" onSubmit={(event) => { event.preventDefault(); const column = filterColumn() || filterColumns()[0]?.key; if (column) props.controller.filter(filterValue() ? { column, value: filterValue() } : undefined); }}>
        <select aria-label={t('database.filterColumn')} value={filterColumn() || filterColumns()[0]?.key} onChange={(e) => setFilterColumn(e.currentTarget.value)}>
          <For each={filterColumns()}>{(column) => <option value={column.key}>{column.label}</option>}</For>
        </select>
        <input aria-label={t('database.filter')} placeholder={t('database.filter')} value={filterValue()} onInput={(e) => setFilterValue(e.currentTarget.value)} />
        <button class="icon-btn" type="submit" disabled={props.state.busy} title={t('database.applyFilter')} aria-label={t('database.applyFilter')}><Icon name="search" size={18} /></button>
        {loading()}
      </form>
    </Show>
    <Show when={props.mode === 'data' && props.state.rows}>
      <div class="database-data" tabIndex={0}>
        <DataTable columns={props.state.rows!.columns} rows={rows()} rowOffset={props.state.rows!.offset} sort={props.state.sort} position={props.position} onPosition={props.onPosition}
          cellDetail={(row, column) => {
            const cell = props.state.rows!.rows[row][column];
            return { value: cell.value, type: cell.type === 'blob' ? `BLOB · ${cell.bytes} B · HEX` : cell.type.toUpperCase(),
              truncated: (cell.type === 'text' || cell.type === 'blob') && cell.truncated };
          }}
          pagination={{ busy: props.state.busy, hasPrevious: hasPrevious(),
            hasNext: !props.state.error && !!props.state.rows?.hasMore,
            previous: () => props.controller.previous(), next: () => props.controller.next() }}
          footer={<>
            <Show when={previewLimited()}><div class="database-notice">{t('database.previewLimit')}</div></Show>
            <footer class="database-pagination">
              <button class="icon-btn" disabled={props.state.busy || !hasPrevious()} onClick={() => props.controller.previous()} aria-label={t('database.previous')} title={t('database.previous')}><Icon name="chevron-left" size={18} /></button>
              <span>{rows().length ? `${props.state.rows!.offset + 1}–${props.state.rows!.offset + rows().length}` : '0'}</span>
              <button class="icon-btn" disabled={props.state.busy || !!props.state.error || !props.state.rows?.hasMore} onClick={() => props.controller.next()} aria-label={t('database.next')} title={t('database.next')}><Icon name="chevron-right" size={18} /></button>
            </footer>
          </>}
          onSort={(column) => props.controller.sort({ column, direction: props.state.sort?.column === column && props.state.sort.direction === 'asc' ? 'desc' : 'asc' })} />
      </div>
    </Show>
    <Show when={props.state.description}>{(description) => <div class="database-structure" tabIndex={0}>
      <h3>{t('database.columns')}</h3>
      <DataGrid columns={['name', 'type', 'nullable', 'primaryKey', 'default', 'generated'].map((key) => ({ key, label: t(`database.${key}`) }))}
        rows={description().columns.map((c) => [c.name, c.type, c.nullable ? '✓' : '—', c.primaryKey || '—', c.defaultValue, c.generated ? '✓' : '—'])}/>
      <Show when={description().indexes.length}><h3>{t('database.indexes')}</h3>
        <DataGrid columns={['name', 'unique', 'columns', 'sql'].map((key) => ({ key, label: t(`database.${key}`) }))}
          rows={description().indexes.map((i) => [i.name, i.unique ? '✓' : '—', i.columns.join(', '), i.sql])}/>
      </Show>
      <Show when={description().foreignKeys.length}><h3>{t('database.foreignKeys')}</h3>
        <DataGrid columns={['from', 'table', 'to', 'onUpdate', 'onDelete'].map((key) => ({ key, label: t(`database.${key}`) }))}
          rows={description().foreignKeys.map((f) => [f.from, f.table, f.to, f.onUpdate, f.onDelete])}/>
      </Show>
      <Show when={description().sql}><h3>{t('database.sql')}</h3><pre>{description().sql}</pre></Show>
    </div>}</Show>
  </section>;
}
