import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { copyText } from '../clipboard.ts';
import { t } from '../i18n.ts';

export type TableCellDetail = { value: string | number | null | undefined; type?: string; truncated?: boolean };

export function DetailIcon(props: { kind: 'copy' | 'close' | 'expand' | 'collapse' }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <Show when={props.kind === 'copy'}><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></Show>
    <Show when={props.kind === 'close'}><path d="m6 6 12 12M6 18 18 6"/></Show>
    <Show when={props.kind === 'expand'}><path d="M8 3H3v5m0-5 7 7m6 11h5v-5m0 5-7-7"/></Show>
    <Show when={props.kind === 'collapse'}><path d="M3 10h7V3m0 7L3 3m18 11h-7v7m0-7 7 7"/></Show>
  </svg>;
}

export function CopyCell(props: { detail: TableCellDetail }) {
  const [status, setStatus] = createSignal('');
  let sequence = 0, timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => { props.detail.value; props.detail.truncated; sequence++; setStatus(''); clearTimeout(timer); });
  onCleanup(() => { sequence++; clearTimeout(timer); });
  const copy = async () => {
    const current = ++sequence;
    const value = props.detail.value;
    const success = await copyText(value === null ? 'NULL' : value === undefined ? '' : String(value));
    if (current !== sequence) return;
    setStatus(success ? 'table.copied' : 'table.copyFailed');
    timer = setTimeout(() => setStatus(''), 2500);
  };
  return <span class="table-copy">
    <Show when={status()}><span class="table-copy-status" role="status">{t(status())}</span></Show>
    <button class="icon-btn" type="button" title={t(props.detail.truncated ? 'table.copyPreview' : 'table.copy')} aria-label={t(props.detail.truncated ? 'table.copyPreview' : 'table.copy')} onClick={() => void copy()}><DetailIcon kind="copy"/></button>
  </span>;
}

export function DetailValue(props: { detail: TableCellDetail }) {
  const empty = () => props.detail.value === null || props.detail.value === undefined || props.detail.value === '';
  return <>
    <Show when={props.detail.type}><span class="table-value-type">{props.detail.type}</span></Show>
    <pre class="table-detail-value" classList={{ 'table-detail-empty': empty() }}>{props.detail.value === null ? 'NULL'
      : props.detail.value === undefined ? t('table.missing') : props.detail.value === '' ? t('table.emptyString') : String(props.detail.value)}</pre>
    <Show when={props.detail.truncated}><p class="table-detail-notice">{t('table.truncated')}</p></Show>
  </>;
}

/** Pure record presentation. The caller supplies fields, selection and layout state. */
export function RowDetail(props: {
  row: number; columns: { key: string; label: string }[]; cell(column: number): TableCellDetail;
  expanded: boolean; onExpand(): void; onClose(): void;
  hasPrevious: boolean; hasNext: boolean; busy: boolean; onPrevious(): void; onNext(): void;
  panelRef(element: HTMLElement): void;
}) {
  return <section ref={props.panelRef} class="table-row-detail" classList={{ expanded: props.expanded }} role="region" tabIndex={-1} aria-label={t('table.rowDetail', { row: props.row })}>
    <header class="table-detail-header">
      <strong aria-live="polite">{t('table.rowDetail', { row: props.row })}</strong>
      <button class="icon-btn" type="button" aria-label={t(props.expanded ? 'table.collapse' : 'table.expand')} title={t(props.expanded ? 'table.collapse' : 'table.expand')} onClick={props.onExpand}><DetailIcon kind={props.expanded ? 'collapse' : 'expand'}/></button>
      <button class="icon-btn" type="button" aria-label={t('table.closeRow')} title={t('table.closeRow')} onClick={props.onClose}><DetailIcon kind="close"/></button>
    </header>
    <dl class="table-record-fields"><For each={props.columns}>{(column, index) => <div class="table-record-field">
      <dt><span>{column.label}</span><CopyCell detail={props.cell(index())}/></dt>
      <dd><DetailValue detail={props.cell(index())}/></dd>
    </div>}</For></dl>
    <footer class="table-record-nav">
      <button class="icon-btn" type="button" disabled={props.busy || !props.hasPrevious} onClick={props.onPrevious} aria-label={t('table.previousRecord')} title={t('table.previousRecord')}>‹</button>
      <span>{t('table.rowDetail', { row: props.row })}</span>
      <button class="icon-btn" type="button" disabled={props.busy || !props.hasNext} onClick={props.onNext} aria-label={t('table.nextRecord')} title={t('table.nextRecord')}>›</button>
    </footer>
  </section>;
}
