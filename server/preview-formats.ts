/** Shared format detection; no server or DOM dependencies. */
export type MediaKind = 'audio' | 'video' | 'pdf';
export const PREVIEW_FORMATS: Partial<Record<string, { kind: MediaKind; mime: string }>> = {};
for (const [kind, types] of Object.entries({
  audio: { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm', aiff: 'audio/aiff' },
  video: { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg', '3gp': 'video/3gpp' },
})) for (const [extension, mime] of Object.entries(types)) PREVIEW_FORMATS[`.${extension}`] = { kind: kind as MediaKind, mime };
PREVIEW_FORMATS['.pdf'] = { kind: 'pdf', mime: 'application/pdf' };

export function looksLikeText(sample: Uint8Array, more: boolean): boolean {
  if (sample.includes(0)) return false;
  let controls = 0;
  for (const byte of sample) if (byte < 32 && ![9, 10, 12, 13, 27].includes(byte)) controls++;
  if (controls > sample.length * 0.02) return false;
  try {
    // 只读开头；采样边界可能截断一个 UTF-8 字符，此时保留解码器未完成状态。
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: more });
    return true;
  } catch { return false; }
}
