import { createMemo, Show } from 'solid-js';
import { parseDelimited } from '../tabular.ts';
import { t } from '../i18n.ts';
import { DataTable } from './data-table.tsx';
import './file-preview.css';

export function TablePreview(props: { path: string; content: string }) {
  const parsed = createMemo(() => parseDelimited(props.content, /\.tsv$/i.test(props.path) ? '\t' : ',', 1000));
  const columns = createMemo(() => Math.min(100, parsed().rows.reduce((max, row) => Math.max(max, row.length), 0)));
  const gridColumns = createMemo(() => Array.from({ length: columns() }, (_, i) => ({ key: String(i), label: String(i + 1) })));
  const rows = createMemo(() => parsed().rows.map((row) => row.slice(0, columns())));
  return (
    <section class="table-preview" aria-label={props.path} tabIndex={0}>
      <Show when={parsed().truncated || parsed().rows.some((row) => row.length > 100)}>
        <p class="table-preview-notice" role="status">{t('preview.tableLimit')}</p>
      </Show>
      <Show when={parsed().rows.length} fallback={<p>{t('preview.emptyTable')}</p>}>
        <DataTable columns={gridColumns()} rows={rows()} rowOffset={0} ariaLabel={props.path} />
      </Show>
    </section>
  );
}
