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
import { findNodeAtOffset, getTextNodes, resolveElementInfo } from './dom-utils.ts';
export type LBPPath = number[];
export interface LBPPoint { spineIndex: number; elementPath: LBPPath; charOffset: number; }
export interface LBPRange { bookId: string; start: LBPPoint; end: LBPPoint; }
// An empty path addresses the chapter body itself, including its direct text nodes.
const PATTERN = /^(.+)::(\d+)@((?:\d+(?:\/\d+)*)?)#(\d+)(?:-(?:(\d+)@)?((?:\d+(?:\/\d+)*)?)#(\d+))?$/;
export function parseLBP(value: unknown): LBPRange | null {
  if (typeof value !== 'string') return null;
  const m = PATTERN.exec(value);
  if (!m) return null;
  const point = (spine: string, path: string, offset: string): LBPPoint => ({
    spineIndex: Number(spine), elementPath: path ? path.split('/').map(Number) : [], charOffset: Number(offset),
  });
  const start = point(m[2]!, m[3]!, m[4]!);
  const end = m[7] !== undefined ? point(m[5] ?? m[2]!, m[6]!, m[7]) : { ...start, elementPath: [...start.elementPath] };
  if (![start, end].every(p => [p.spineIndex, p.charOffset, ...p.elementPath].every(n => Number.isSafeInteger(n) && n >= 0))) return null;
  if (end.spineIndex < start.spineIndex) return null;
  if (end.spineIndex === start.spineIndex && end.elementPath.join('/') === start.elementPath.join('/') && end.charOffset < start.charOffset) return null;
  return { bookId: m[1]!, start, end };
}
export function serializeLBPPoint(p: LBPPoint): string {
  return p.spineIndex + '@' + p.elementPath.join('/') + '#' + p.charOffset;
}
export function serializeLBP(range: LBPRange): string {
  const start = serializeLBPPoint(range.start), end = serializeLBPPoint(range.end);
  return range.bookId + '::' + start + (start === end ? '' : '-' + end);
}
export function chapterPoint(bookId: string, spineIndex: number): LBPRange {
  const point = { spineIndex, elementPath: [], charOffset: 0 };
  return { bookId, start: point, end: { ...point } };
}
export function pointFromDom(bookId: string, spineIndex: number, root: HTMLElement, node: Node, offset: number): LBPRange {
  const info = resolveElementInfo(node, offset, root);
  const point = { spineIndex, elementPath: info.path, charOffset: info.offset };
  return { bookId, start: point, end: { ...point } };
}
export function rangeFromSelection(bookId: string, range: Range, container: HTMLElement): LBPRange | null {
  const chapter = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest<HTMLElement>('.epub-chapter-body');
  const a = chapter(range.startContainer), b = chapter(range.endContainer);
  if (!a || !b || !container.contains(a) || !container.contains(b)) return null;
  const start = pointFromDom(bookId, Number(a.dataset.spine), a, range.startContainer, range.startOffset).start;
  const end = pointFromDom(bookId, Number(b.dataset.spine), b, range.endContainer, range.endOffset).end;
  return { bookId, start, end };
}
export class LBPResolver {
  static resolveElement(root: HTMLElement, path: LBPPath): HTMLElement | null {
    let element: HTMLElement | null = root;
    for (const index of path) {
      if (!Number.isSafeInteger(index) || index < 0) return null;
      element = element?.querySelector<HTMLElement>(':scope > [data-lidx="' + index + '"]') ?? null;
    }
    return element;
  }
  static resolvePoint(root: HTMLElement, point: LBPPoint): { node: Node; offset: number } | null {
    const el = this.resolveElement(root, point.elementPath);
    if (!el) return null;
    const nodes = getTextNodes(el);
    if (!nodes.length && point.charOffset === 0) return { node: el, offset: 0 };
    return findNodeAtOffset(nodes, point.charOffset);
  }
  /** Return the part of a range belonging to this chapter, without changing user selection. */
  static rangeInChapter(root: HTMLElement, chapter: number, lbp: LBPRange): Range | null {
    if (chapter < lbp.start.spineIndex || chapter > lbp.end.spineIndex) return null;
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    if (chapter === lbp.start.spineIndex) {
      const p = this.resolvePoint(root, lbp.start); if (!p) return null;
      range.setStart(p.node, p.offset);
    }
    if (chapter === lbp.end.spineIndex) {
      const p = this.resolvePoint(root, lbp.end); if (!p) return null;
      range.setEnd(p.node, p.offset);
    }
    return range;
  }
}
