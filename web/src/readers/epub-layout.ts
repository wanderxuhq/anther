/** Chapter frames grow with content, so CSS viewport units must refer to the
 * reader viewport, never the frame whose height we are measuring. */
export function stabilizeEpubCss(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\((?:\\.|[^)])*\)|(?<![\w.-])([+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?)(?:[sld]?)(vmin|vmax|vh|vw)\b/gi,
    (token, number: string | undefined, unit: string | undefined) => number === undefined
      ? token : `calc(${number} * var(--anther-epub-${unit!.toLowerCase()}))`);
}

export function setEpubViewport(doc: Document, width: number, height: number, scale: number): void {
  const style = doc.documentElement.style;
  const w = width / scale, h = height / scale;
  for (const [unit, value] of Object.entries({ vw: w, vh: h, vmin: Math.min(w, h), vmax: Math.max(w, h) })) {
    style.setProperty(`--anther-epub-${unit}`, `${value / 100}px`, 'important');
  }
  // Give percentage heights a stable containing block as well. Content may
  // overflow this block; the frame is sized from the body's actual content.
  style.setProperty('height', `${h}px`, 'important');
  style.setProperty('min-height', '0', 'important');
  style.setProperty('max-height', 'none', 'important');
  style.setProperty('overflow', 'visible', 'important');
}
