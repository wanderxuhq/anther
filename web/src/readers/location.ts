import { parseLBP, serializeLBP, type LBPRange } from './lbp.ts';
import { PREVIEW_FORMATS } from '../../../server/preview-formats.ts';
import { parseTablePosition, writeTablePosition, type ImagePosition, type MediaPosition, type TableLocation } from '../preview-state.ts';

/** The URL already identifies the document, including every enclosing archive. */
export type ReadingLocation =
  | ImagePosition | MediaPosition | TableLocation
  | { kind: 'epub'; lbp: string; zoom?: number }
  | { kind: 'pdf'; page: number; x?: number; y?: number; zoom?: number }
  | { kind: 'markdown'; heading: string };

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

export function writeReadingLocation(params: URLSearchParams, path: string, location: ReadingLocation | null) {
  if (!location) return;
  const fields = new URLSearchParams();
  if (location.kind === 'image') {
    if (location.zoom === undefined) return;
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
  else return;
  if ('zoom' in location && location.zoom !== undefined) fields.set('zoom', String(Math.round(location.zoom * 10000) / 100));
  const valid = parseReadingLocation(path, fields);
  if (!valid || valid.kind !== location.kind) return;
  if (valid.kind === 'image') {
    if (valid.x !== undefined) params.set('x', String(valid.x)); if (valid.y !== undefined) params.set('y', String(valid.y));
  } else if (valid.kind === 'media') {
    params.set('time', String(valid.time)); if (valid.rate !== undefined) params.set('rate', String(valid.rate));
  } else if (valid.kind === 'table') writeTablePosition(params, valid);
  else if (valid.kind === 'epub') params.set('lbp', valid.lbp);
  else if (valid.kind === 'pdf') {
    params.set('page', String(valid.page));
    if (valid.x !== undefined) params.set('x', String(valid.x));
    if (valid.y !== undefined) params.set('y', String(valid.y));
  } else params.set('heading', valid.heading);
  if ('zoom' in valid && valid.zoom !== undefined) params.set('zoom', String(Math.round(valid.zoom * 10000) / 100));
}
