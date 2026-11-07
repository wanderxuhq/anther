import { For, Show, type JSX } from 'solid-js';
import './data-grid.css';
import { t } from '../i18n.ts';
import { Icon } from './icons.tsx';

export type DataGridColumn = { key: string; label: string };
export type DataGridSort = { column: string; direction: 'asc' | 'desc' };

export function DataGrid(props: {
  columns: DataGridColumn[];
  rows: (string | number | null)[][];
  rowOffset?: number;
  renderCell?: (value: string | number | null | undefined, row: number, column: number) => JSX.Element;
  ariaLabel?: string;
  onSort?: (columnKey: string) => void;
  sort?: DataGridSort;
  compact?: boolean;
  selectedRow?: number | null;
  onCell?: (row: number, column: number, anchor: HTMLButtonElement) => void;
  onRow?: (row: number, anchor: HTMLButtonElement) => void;
}) {
  let origin: { x: number; y: number } | undefined, moved = false;
  return (
    <table class="data-grid" classList={{ 'data-grid-compact': props.compact }} aria-label={props.ariaLabel}
      onPointerDown={(event) => { origin = { x: event.clientX, y: event.clientY }; moved = false; }}
      onPointerMove={(event) => { if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) moved = true; }}
      onPointerCancel={() => { moved = true; origin = undefined; }}>
      <thead>
        <tr>
          <th scope="col">#</th>
          <For each={props.columns}>{(column) => {
            const sorted = () => props.sort?.column === column.key;
            return (
              <th scope="col" aria-sort={sorted() ? (props.sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <Show when={props.onSort} fallback={column.label}>
                  <button
                    class="data-grid-sort"
                    type="button"
                    aria-label={t('table.sort', { column: column.label })}
                    onClick={() => props.onSort?.(column.key)}
                  >
                    {column.label}
                    <Show when={sorted()}><Icon name={props.sort?.direction === 'asc' ? 'sort-asc' : 'sort-desc'} size={14} /></Show>
                  </button>
                </Show>
              </th>
            );
          }}</For>
        </tr>
      </thead>
      <tbody>
        <For each={props.rows}>{(row, index) => (
          <tr classList={{ 'data-grid-selected': props.selectedRow === index() }}>
            <th scope="row"><Show when={props.onRow} fallback={(props.rowOffset ?? 0) + index() + 1}>
              <button class="data-grid-row-button" type="button" aria-expanded={props.selectedRow === index()}
                aria-label={t('table.inspectRow', { row: (props.rowOffset ?? 0) + index() + 1 })}
                onClick={(event) => { if (!moved || event.detail === 0) props.onRow?.(index(), event.currentTarget); }}>
                {(props.rowOffset ?? 0) + index() + 1}
              </button>
            </Show></th>
            <For each={props.columns}>{(_, columnIndex) => {
              const value = row[columnIndex()];
              const content = () => props.renderCell ? props.renderCell(value, index(), columnIndex()) : value === null ? 'NULL' : value === undefined ? '' : value;
              return <td classList={{ 'data-grid-null': value === null }}><Show when={props.onCell} fallback={content()}>
                <button class="data-grid-cell" type="button" aria-haspopup="dialog"
                  aria-label={t('table.inspectCell', { row: (props.rowOffset ?? 0) + index() + 1, column: props.columns[columnIndex()].label })}
                  onClick={(event) => { if (!moved || event.detail === 0) props.onCell?.(index(), columnIndex(), event.currentTarget); }}>{content()}</button>
              </Show></td>;
            }}</For>
          </tr>
        )}</For>
      </tbody>
    </table>
  );
}
