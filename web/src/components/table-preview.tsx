import { createMemo, For, Show } from 'solid-js';
import { parseDelimited } from '../tabular.ts';
import { t } from '../i18n.ts';
import './file-preview.css';

export function TablePreview(props: { path: string; content: string }) {
  const parsed = createMemo(() => parseDelimited(props.content, /\.tsv$/i.test(props.path) ? '\t' : ',', 1000));
  const columns = createMemo(() => Math.min(100, parsed().rows.reduce((max, row) => Math.max(max, row.length), 0)));
  const indexes = createMemo(() => Array.from({ length: columns() }, (_, i) => i));
  return (
    <section class="table-preview" aria-label={props.path} tabIndex={0}>
      <Show when={parsed().truncated || parsed().rows.some((row) => row.length > 100)}>
        <p class="table-preview-notice" role="status">{t('preview.tableLimit')}</p>
      </Show>
      <Show when={parsed().rows.length} fallback={<p>{t('preview.emptyTable')}</p>}>
        <table>
          <thead><tr><th scope="col">#</th><For each={indexes()}>{(i) => <th scope="col">{i + 1}</th>}</For></tr></thead>
          <tbody><For each={parsed().rows}>{(row, index) => <tr>
            <th scope="row">{index() + 1}</th><For each={indexes()}>{(i) => <td>{row[i] ?? ''}</td>}</For>
          </tr>}</For></tbody>
        </table>
      </Show>
    </section>
  );
}
