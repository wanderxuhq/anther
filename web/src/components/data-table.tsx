import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { DataGrid, type DataGridColumn, type DataGridSort } from './data-grid.tsx';
import { CopyCell, DetailIcon, DetailValue, RowDetail, type TableCellDetail } from './table-detail.tsx';
import { t } from '../i18n.ts';
import './data-table.css';

/** Shared table interaction; data loading and format-specific cell metadata stay outside. */
export function DataTable(props: {
  columns: DataGridColumn[];
  rows: (string | number | null)[][];
  rowOffset?: number;
  ariaLabel?: string;
  sort?: DataGridSort;
  onSort?: (column: string) => void;
  cellDetail?: (row: number, column: number) => TableCellDetail;
  footer?: JSX.Element;
  pagination?: {
    busy: boolean; hasPrevious: boolean; hasNext: boolean;
    previous(): Promise<boolean>; next(): Promise<boolean>;
  };
}) {
  let root!: HTMLDivElement, viewport!: HTMLDivElement, panel: HTMLElement | undefined, popup: HTMLDivElement | undefined;
  let rowAnchor: HTMLButtonElement | undefined, frame = 0;
  const [row, setRow] = createSignal<number | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [navigating, setNavigating] = createSignal(false);
  let pendingRow: { direction: -1 | 1; rows: typeof props.rows } | undefined;
  const [cell, setCell] = createSignal<{ row: number; column: number; anchor: HTMLButtonElement } | null>(null);
  const [position, setPosition] = createSignal<{ left: string; top: string; visibility: 'hidden' | 'visible' }>({ left: '12px', top: '12px', visibility: 'hidden' });
  const detail = (row: number, column: number) => props.cellDetail?.(row, column) ?? { value: props.rows[row]?.[column] };
  const closeCell = (focus = true) => { const anchor = cell()?.anchor; setCell(null); if (focus && anchor?.isConnected) anchor.focus({ preventScroll: true }); };
  const closeRow = (focus = true) => { pendingRow = undefined; setRow(null); setExpanded(false); if (focus && rowAnchor?.isConnected) rowAnchor.focus({ preventScroll: true }); };
  const reset = () => { closeCell(false); closeRow(false); };
  const selectRow = (index: number) => {
    setRow(index);
    queueMicrotask(() => {
      rowAnchor = viewport.querySelectorAll<HTMLButtonElement>('.data-grid-row-button')[index];
      panel?.querySelector('.table-record-fields')?.scrollTo?.({ top: 0 });
      // Reveal the selected record without moving the page or horizontal table position.
      if (rowAnchor) {
        const bounds = rowAnchor.getBoundingClientRect(), area = viewport.getBoundingClientRect();
        const header = viewport.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        if (bounds.top < area.top + header) viewport.scrollTop += bounds.top - area.top - header;
        else if (bounds.bottom > area.bottom) viewport.scrollTop += bounds.bottom - area.bottom;
      }
    });
  };
  const tableRows = createMemo(() => props.rows);
  const tableColumns = createMemo(() => props.columns);
  const tableOffset = createMemo(() => props.rowOffset);
  createEffect(on(() => [tableRows(), tableColumns(), tableOffset()], () => {
    if (pendingRow && props.rows !== pendingRow.rows && props.rows.length) {
      selectRow(pendingRow.direction === 1 ? 0 : props.rows.length - 1);
    } else reset();
  }));
  const moveRow = async (direction: -1 | 1) => {
    const current = row();
    if (current === null || navigating() || props.pagination?.busy) return;
    const index = current + direction;
    if (index >= 0 && index < props.rows.length) { selectRow(index); return; }
    const pagination = props.pagination;
    if (!pagination || !(direction === 1 ? pagination.hasNext : pagination.hasPrevious)) return;
    const request = pendingRow = { direction, rows: props.rows };
    setNavigating(true);
    try { await (direction === 1 ? pagination.next() : pagination.previous()); }
    finally { if (pendingRow === request) pendingRow = undefined; setNavigating(false); }
  };

  const openRow = (index: number, anchor: HTMLButtonElement) => {
    if (navigating()) return;
    closeCell(false);
    if (row() === index) { closeRow(); return; }
    const initial = row() === null;
    rowAnchor = anchor; setRow(index);
    if (panel) panel.querySelector('.table-record-fields')?.scrollTo?.({ top: 0 });
    if (initial) queueMicrotask(() => panel?.focus({ preventScroll: true }));
  };
  const openCell = (index: number, column: number, anchor: HTMLButtonElement) => {
    if (navigating()) return;
    if (row() !== null) {
      setRow(index);
      rowAnchor = viewport.querySelectorAll<HTMLButtonElement>('.data-grid-row-button')[index];
      // Keep the table still; reveal the tapped field inside the detail panel only.
      queueMicrotask(() => {
        const list = panel?.querySelector<HTMLElement>('.table-record-fields');
        const field = list?.children[column] as HTMLElement | undefined;
        if (list && field) list.scrollTop += field.getBoundingClientRect().top - list.getBoundingClientRect().top;
      });
      return;
    }
    if (cell()?.row === index && cell()?.column === column) { closeCell(); return; }
    setPosition({ left: '12px', top: '12px', visibility: 'hidden' });
    setCell({ row: index, column, anchor });
  };
  createEffect(() => {
    const selected = cell();
    if (!selected) return;
    frame = requestAnimationFrame(() => {
      if (!popup || cell() !== selected) return;
      const bounds = selected.anchor.getBoundingClientRect(), box = popup.getBoundingClientRect();
      const visual = window.visualViewport;
      const left = visual?.offsetLeft ?? 0, top = visual?.offsetTop ?? 0;
      const width = visual?.width ?? window.innerWidth, height = visual?.height ?? window.innerHeight;
      const x = Math.max(left + 8, Math.min(bounds.left, left + width - box.width - 8));
      const y = bounds.bottom + 8 + box.height <= top + height - 8 ? bounds.bottom + 8 : Math.max(top + 8, bounds.top - box.height - 8);
      setPosition({ left: `${x}px`, top: `${y}px`, visibility: 'visible' });
      popup.focus({ preventScroll: true });
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  const outside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (cell() && !popup?.contains(target) && !cell()?.anchor.contains(target)) closeCell(false);
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || (!root.contains(document.activeElement) && !popup?.contains(document.activeElement))) return;
    if (cell()) { event.preventDefault(); closeCell(); }
    else if (row() !== null) { event.preventDefault(); closeRow(); }
  };
  const reposition = () => closeCell(false);
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  window.addEventListener('resize', reposition);
  window.visualViewport?.addEventListener('resize', reposition);
  onCleanup(() => {
    pendingRow = undefined;
    cancelAnimationFrame(frame);
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
    window.removeEventListener('resize', reposition);
    window.visualViewport?.removeEventListener('resize', reposition);
  });
  return <div class="data-table" ref={root}>
    <div class="data-table-scroll" ref={viewport} tabIndex={0} inert={expanded()} onScroll={() => closeCell(false)}>
      <DataGrid columns={props.columns} rows={props.rows} rowOffset={props.rowOffset} ariaLabel={props.ariaLabel}
        compact sort={props.sort} onSort={props.onSort} onRow={openRow} onCell={openCell} selectedRow={row()}/>
      <Show when={!props.rows.length}><p class="view-placeholder">{t('preview.emptyTable')}</p></Show>
    </div>
    <Show when={row() !== null} fallback={props.footer}><div class="table-row-slot">
      <RowDetail row={(props.rowOffset ?? 0) + row()! + 1} columns={props.columns} cell={(column) => detail(row()!, column)}
        hasPrevious={row()! > 0 || !!props.pagination?.hasPrevious} hasNext={row()! < props.rows.length - 1 || !!props.pagination?.hasNext}
        busy={navigating() || !!props.pagination?.busy} onPrevious={() => void moveRow(-1)} onNext={() => void moveRow(1)}
        expanded={expanded()} onExpand={() => setExpanded(!expanded())} onClose={() => closeRow()} panelRef={(element) => { panel = element; }}/>
    </div></Show>
    <Show when={cell()}>{(selected) => <Portal><div ref={popup} class="table-cell-popover" role="dialog" aria-modal="false" tabIndex={-1}
      aria-label={props.columns[selected().column]?.label} style={position()}>
      <header class="table-detail-header">
        <strong>{props.columns[selected().column]?.label}</strong>
        <CopyCell detail={detail(selected().row, selected().column)}/>
        <button class="icon-btn" type="button" title={t('table.closeCell')} aria-label={t('table.closeCell')} onClick={() => closeCell()}><DetailIcon kind="close"/></button>
      </header>
      <div class="table-cell-value"><DetailValue detail={detail(selected().row, selected().column)}/></div>
    </div></Portal>}</Show>
  </div>;
}
