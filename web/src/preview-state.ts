/** Content coordinates and user choices only; no DOM or application stores. */
export type ImagePosition = { kind: 'image'; zoom?: number; x?: number; y?: number };
export type MediaPosition = { kind: 'media'; time: number; rate?: number };
export type TablePosition = { row?: number; column?: number; expanded?: boolean; at?: number; across?: number };
export type TableLocation = TablePosition & { kind: 'table' };
export const positiveIndex = (value: string | null) => value && /^\d+$/.test(value) && Number.isSafeInteger(+value) && +value > 0 ? +value : undefined;
export const finiteNumber = (value: string | null) => value !== null && value.trim() !== '' && Number.isFinite(+value) ? +value : undefined;
export function parseTablePosition(params: URLSearchParams): TablePosition | undefined {
  const row = positiveIndex(params.get('row')), column = positiveIndex(params.get('column'));
  const at = positiveIndex(params.get('at')), across = positiveIndex(params.get('across'));
  const value: TablePosition = { ...(row ? { row, ...(column ? { column } : params.get('expanded') === '1' ? { expanded: true } : {}) } : {}),
    ...(at && at > 1 ? { at } : {}), ...(across && across > 1 ? { across } : {}) };
  return Object.keys(value).length ? value : undefined;
}
export function writeTablePosition(params: URLSearchParams, value?: TablePosition) {
  if (!value) return;
  if (value.row) { params.set('row', String(value.row)); if (value.column) params.set('column', String(value.column)); else if (value.expanded) params.set('expanded', '1'); }
  if (value.at && value.at > 1) params.set('at', String(value.at));
  if (value.across && value.across > 1) params.set('across', String(value.across));
}
