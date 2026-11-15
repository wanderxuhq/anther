import { parseLBP, serializeLBP, type LBPRange } from './lbp.ts';
import { PREVIEW_FORMATS } from '../../../server/preview-formats.ts';
import { parseTablePosition, writeTablePosition, type ImagePosition, type MediaPosition, type TableLocation } from '../preview-state.ts';

/** The URL already identifies the document, including every enclosing archive. */
export type ReadingLocation =
  | ImagePosition | MediaPosition | TableLocation
  | { kind: 'epub'; lbp: string; zoom?: number }
  | { kind: 'pdf'; page: number; x?: number; y?: number; zoom?: number }
  | { kind: 'markdown'; heading: string };

/** Debounce for scroll/position changes before publishing a reading location. */
export const POSITION_PUBLISH_DEBOUNCE_MS = 180;

export const locationLBP = (value: string): LBPRange | null => value.length <= 4096 ? parseLBP('_::' + value) : null;
export const compactLBP = (range: LBPRange) => serializeLBP(range).slice(range.bookId.length + 2);
const positive = (value: string | null) => value && /^\d+$/.test(value) && Number.isSafeInteger(+value) && +value > 0 ? +value : null;
const finite = (value: string | null) => value !== null && value.trim() !== '' && Number.isFinite(+value) ? +value : undefined;

export function parseReadingLocation(path: string, params: URLSearchParams): ReadingLocation | null {
  const zoomValue = finite(params.get('zoom'));
  const zoom = zoomValue !== undefined && zoomValue >= 10 && zoomValue <= 500 ? zoomValue / 100 : undefined;
  if (/\.(png|apng|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(path)) {
    const imageZoom = zoomValue !== undefined && zoomValue > 0 && zoomValue <= 800 ? zoomValue / 100 : undefined;
    const x = finite(params.get('x')), y = finite(params.get('y'));
    return imageZoom === undefined ? null : { kind: 'image', zoom: imageZoom,
      ...(x !== undefined && x >= 0 && x <= 1 ? { x } : {}), ...(y !== undefined && y >= 0 && y <= 1 ? { y } : {}) };
  }
  const format = PREVIEW_FORMATS[/\.[^.\/]+$/.exec(path)?.[0].toLowerCase() ?? '']?.kind;
  if (format === 'audio' || format === 'video') {
    const time = finite(params.get('time')), rate = finite(params.get('rate'));
    return time !== undefined && time >= 0 || rate !== undefined && rate >= .25 && rate <= 4
      ? { kind: 'media', time: time !== undefined && time >= 0 ? time : 0, ...(rate !== undefined && rate >= .25 && rate <= 4 && rate !== 1 ? { rate } : {}) } : null;
  }
  if (/\.(csv|tsv)$/i.test(path)) { const position = parseTablePosition(params); return position ? { kind: 'table', ...position } : null; }
  if (/\.epub$/i.test(path)) {
    const range = locationLBP(params.get('lbp') ?? '');
    return range || zoom !== undefined ? { kind: 'epub', lbp: range ? compactLBP(range) : '0@#0', ...(zoom === undefined || zoom === 1 ? {} : { zoom }) } : null;
  }
  if (/\.pdf$/i.test(path)) {
    const page = positive(params.get('page')), x = finite(params.get('x')), y = finite(params.get('y'));
    return page || zoom !== undefined ? { kind: 'pdf', page: page ?? 1,
      ...(x === undefined || Math.abs(x) > 1e7 ? {} : { x }), ...(y === undefined || Math.abs(y) > 1e7 ? {} : { y }),
      ...(zoom === undefined ? {} : { zoom }) } : null;
  }
  const heading = params.get('heading');
  return /\.(md|markdown|mdown|mkdn|mkd)$/i.test(path) && heading && heading.length <= 4096
    ? { kind: 'markdown', heading } : null;
}

/** Map a location to URL fields; null means the value cannot be represented for this path. */
function locationFields(location: ReadingLocation, path: string): URLSearchParams | null {
  const fields = new URLSearchParams();
  if (location.kind === 'image') {
    if (location.zoom === undefined) return null;
    if (location.x !== undefined) fields.set('x', String(location.x));
    if (location.y !== undefined) fields.set('y', String(location.y));
  } else if (location.kind === 'media') {
    fields.set('time', String(location.time)); if (location.rate !== undefined) fields.set('rate', String(location.rate));
  } else if (location.kind === 'table') writeTablePosition(fields, location);
  else if (location.kind === 'epub' && /\.epub$/i.test(path) && locationLBP(location.lbp)) fields.set('lbp', location.lbp);
  else if (location.kind === 'pdf' && /\.pdf$/i.test(path)) {
    fields.set('page', String(location.page));
    if (location.x !== undefined) fields.set('x', String(location.x));
    if (location.y !== undefined) fields.set('y', String(location.y));
  } else if (location.kind === 'markdown') fields.set('heading', location.heading);
  else return null;
  if ('zoom' in location && location.zoom !== undefined) fields.set('zoom', String(Math.round(location.zoom * 10000) / 100));
  return fields;
}

export function writeReadingLocation(params: URLSearchParams, path: string, location: ReadingLocation | null) {
  if (!location) return;
  const fields = locationFields(location, path);
  if (!fields) return;
  const valid = parseReadingLocation(path, fields);
  if (!valid || valid.kind !== location.kind) return;
  const normalized = locationFields(valid, path);
  if (!normalized) return;
  for (const [key, value] of normalized) params.set(key, value);
}
