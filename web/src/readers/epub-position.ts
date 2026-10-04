/*!
 * Adapted from https://github.com/wanderxuhq/leaf-reader
 * Revision: 2d57df6c01792ad609316c7dc2a32a1642c1d3e7
 * MIT License
 *
 * Copyright (c) 2026 wanderxuhq
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { getTextNodes } from './dom-utils.ts';
import { chapterPoint, pointFromDom, LBPResolver, type LBPRange } from './lbp.ts';

/** Leaf Reader's text coordinate capture, adapted to isolated chapter documents. */
export function captureEpubPosition(root: HTMLElement, spine: number, top: number, bottom: number): LBPRange {
  for (const node of getTextNodes(root)) {
    if (!node.textContent?.trim()) continue;
    const range = root.ownerDocument.createRange(); range.selectNodeContents(node);
    const bounds = range.getBoundingClientRect();
    if (bounds.bottom <= top || !bounds.height || bounds.top >= bottom) continue;
    let low = 0, high = node.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      range.setStart(node, middle); range.setEnd(node, Math.min(middle + 1, node.length));
      if (range.getBoundingClientRect().bottom <= top) low = middle + 1; else high = middle;
    }
    return pointFromDom('_', spine, root, node, low);
  }
  return chapterPoint('_', spine);
}

/** A stale element path falls back to the closest surviving ancestor, then chapter start. */
export function epubPositionTop(root: HTMLElement, position: LBPRange): number {
  const point = LBPResolver.resolvePoint(root, position.start);
  if (point) {
    const range = root.ownerDocument.createRange();
    range.setStart(point.node, point.offset); range.collapse(true);
    const rect = range.getClientRects()[0];
    if (rect?.height) return rect.top;
  }
  const path = [...position.start.elementPath];
  while (path.length) {
    const element = LBPResolver.resolveElement(root, path);
    if (element) return element.getBoundingClientRect().top;
    path.pop();
  }
  return 0;
}
