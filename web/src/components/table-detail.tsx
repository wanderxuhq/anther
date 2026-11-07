import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { copyText } from '../clipboard.ts';
import { t } from '../i18n.ts';
import { Icon, type IconName } from './icons.tsx';

export type TableCellDetail = { value: string | number | null | undefined; type?: string; truncated?: boolean };

export function DetailIcon(props: { kind: 'copy' | 'close' | 'expand' | 'collapse' }) {
  const name = (): IconName => props.kind;
  return <Icon name={name()} size={18} />;
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
      <button class="icon-btn" type="button" disabled={props.busy || !props.hasPrevious} onClick={props.onPrevious} aria-label={t('table.previousRecord')} title={t('table.previousRecord')}><Icon name="chevron-left" size={18} /></button>
      <span>{t('table.rowDetail', { row: props.row })}</span>
      <button class="icon-btn" type="button" disabled={props.busy || !props.hasNext} onClick={props.onNext} aria-label={t('table.nextRecord')} title={t('table.nextRecord')}><Icon name="chevron-right" size={18} /></button>
    </footer>
  </section>;
}
