import { setEpubViewport } from './epub-layout.ts';
import { acquireEpubSource } from './epub-source.ts';
import { initialReaderState, type ReaderController, type ReaderFactory } from './types.ts';
import type { EpubBook, EpubLink } from './epub-data.ts';
import { bindReaderGestures } from '../components/reader-gestures.ts';
import { t } from '../i18n.ts';
import './epub.css';
import { compactLBP, locationLBP, type ReadingLocation } from './location.ts';
import { captureEpubPosition, epubPositionTop } from './epub-position.ts';

type ChapterView = { node: HTMLElement; generation: number; cancel?: AbortController; pending?: Promise<void>; frame?: HTMLIFrameElement; cleanup?: () => void; measure?: () => void };

/** Continuous chapter layout. The source owns ZIP/package/content; this adapter only owns views. */
export const createEpubReader: ReaderFactory = ({ url, viewport, content, onState, initialLocation, onLocation }) => {
  const source = acquireEpubSource(url), views: ChapterView[] = [];
  let visible: number[] = [];
  let book: EpubBook | undefined, disposed = false, scrollFrame = 0, navigation = 0, navigating = true;
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  let lastLocation: ReadingLocation | null = initialLocation ?? null;
  let state = initialReaderState();
  const update: typeof onState = (patch) => { if (!disposed) { state = { ...state, ...patch }; onState(patch); } };
  const fail = (error: unknown) => update({ busy: false, error: (error as { readerError?: 'unsupported' })?.readerError ?? 'loadFailed' });
  content.classList.add('epub-stage');
  update({ unit: 'chapter', canZoom: true, canFitWidth: true, outlineStatus: 'loading' });
  const unsubscribe = source.subscribe(update);
  const top = (index: number) => views[index].node.getBoundingClientRect().top - content.getBoundingClientRect().top;
  const indexAt = (position: number) => {
    let low = 0, high = visible.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (top(visible[middle]) <= position) low = middle; else high = middle - 1; }
    return visible[low] ?? 0;
  };
  // Keep package spine indices stable for LBP, while auxiliary chapters enter
  // the continuous layout only when explicitly opened (e.g. a footnote link).
  const reveal = (index: number) => {
    visible = [];
    views.forEach((view, i) => {
      view.node.hidden = !book!.spine[i].linear && i !== index;
      if (!view.node.hidden) visible.push(i);
    });
  };
  const firstChapter = () => Math.max(0, book!.spine.findIndex((item) => item.linear));
  const current = () => indexAt(viewport.scrollTop + 24);
  const publish = () => {
    if (disposed || navigating || !book) return;
    const index = current(), frame = views[index]?.frame, root = frame?.contentDocument?.body;
    if (!frame || !root) return;
    const bounds = viewport.getBoundingClientRect(), chapter = frame.getBoundingClientRect();
    const lbp = compactLBP(captureEpubPosition(root, index, bounds.top + 4 - chapter.top, bounds.bottom - chapter.top));
    lastLocation = { kind: 'epub', lbp, ...(state.scale === 1 ? {} : { zoom: state.scale }) };
    onLocation?.(lastLocation);
  };
  const schedulePosition = () => { clearTimeout(positionTimer); positionTimer = setTimeout(publish, 180); };
  const unload = (view: ChapterView) => { view.generation++; view.cancel?.abort(); view.cancel = undefined; view.cleanup?.(); view.cleanup = undefined; view.frame = undefined; view.measure = undefined; view.pending = undefined; view.node.replaceChildren(); };
  const load = (index: number): Promise<void> => {
    const view = views[index];
    if (!view || view.frame) return Promise.resolve();
    if (view.pending) return view.pending;
    const generation = ++view.generation;
    const cancel = new AbortController(); view.cancel = cancel;
    view.node.setAttribute('aria-busy', 'true');
    const active = () => !disposed && generation === view.generation;
    const pending = (async () => {
      const chapter = await source.chapter(index, cancel.signal);
      if (!active()) { chapter.release(); return; }
      const frame = document.createElement('iframe');
      frame.title = `${book!.title || t('reader.chapter')} — ${index + 1}`;
      frame.setAttribute('sandbox', 'allow-same-origin'); frame.setAttribute('scrolling', 'no');
      frame.referrerPolicy = 'no-referrer'; frame.style.height = '1px';
      let observer: ResizeObserver | undefined, unbind: (() => void) | undefined, loaded!: () => void;
      const ready = new Promise<void>((resolve) => { loaded = resolve; });
      const timeout = setTimeout(() => { loaded(); if (active()) fail(new Error('Chapter layout timed out')); }, 15_000);
      view.cleanup = () => { clearTimeout(timeout); loaded(); observer?.disconnect(); unbind?.(); frame.remove(); chapter.release(); };
      frame.onload = () => {
        if (!active()) return;
        const doc = frame.contentDocument;
        if (!doc?.body) { loaded(); return; }
        doc.documentElement.style.zoom = String(state.scale);
        const measure = () => {
          if (!active()) return;
          setEpubViewport(doc, frame.clientWidth, viewport.clientHeight, state.scale);
          const style = frame.contentWindow!.getComputedStyle(doc.body);
          const height = Math.max(1, Math.ceil(Math.max(doc.body.getBoundingClientRect().height, doc.body.scrollHeight * state.scale) + ((parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0)) * state.scale));
          if (frame.style.height !== `${height}px`) {
            const above = !navigating && index < current(), previous = view.node.offsetHeight;
            frame.style.height = `${height}px`; view.node.style.height = `${height}px`;
            if (above) viewport.scrollTop += height - previous;
            scroll();
          }
        };
        view.measure = measure;
        observer = new ResizeObserver(measure); observer.observe(doc.body);
        // A book may fix the body's height while an image increases its overflow.
        doc.addEventListener('load', measure, true);
        unbind = bindReaderGestures(viewport, content, controller, () => state, { target: doc, toClient(x, y) {
          const bounds = frame.getBoundingClientRect(), ratio = bounds.width / frame.clientWidth;
          return { x: bounds.left + x * ratio, y: bounds.top + y * ratio };
        } });
        doc.addEventListener('click', (event) => {
          const anchor = (event.target as Element).closest?.('a');
          if (!anchor) return;
          event.preventDefault();
          const value = anchor.getAttribute('data-epub-link');
          if (value) void goToLink(JSON.parse(value)).catch(fail);
          else if (/^https?:\/\//i.test(anchor.getAttribute('href') ?? '')) window.open(anchor.getAttribute('href')!, '_blank', 'noopener,noreferrer');
        });
        measure(); void doc.fonts.ready.then(() => { measure(); clearTimeout(timeout); loaded(); });
      };
      frame.srcdoc = chapter.html; view.node.replaceChildren(frame);
      await ready;
      if (active()) { view.frame = frame; view.node.setAttribute('aria-busy', 'false'); }
    })().catch((error) => {
      if (active()) { view.node.setAttribute('aria-busy', 'false'); fail(error); }
    }).finally(() => { if (active()) view.pending = undefined; });
    view.pending = pending;
    return pending;
  };
  const refreshVisible = (index = current()) => {
    if (disposed || !book) return;
    update({ position: index + 1 });
    const position = visible.indexOf(index);
    const first = Math.max(0, position - 1), last = Math.min(visible.length - 1, position + 8, visible.indexOf(indexAt(viewport.scrollTop + viewport.clientHeight)) + 1);
    const wanted = new Set(visible.slice(first, last + 1));
    for (const i of wanted) void load(i);
    for (let i = 0; i < views.length; i++) if (!wanted.has(i) && (views[i].frame || views[i].pending)) unload(views[i]);
    schedulePosition();
  };
  const scroll = () => {
    if (scrollFrame || navigating) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; refreshVisible(); });
  };
  viewport.addEventListener('scroll', scroll, { passive: true });
  const ready = source.book.then(async (value) => {
    if (disposed) return;
    book = value;
    for (let index = 0; index < book.spine.length; index++) {
      const node = document.createElement('section'); node.className = 'epub-chapter'; node.style.height = `${Math.max(400, viewport.clientHeight)}px`;
      content.append(node); views.push({ node, generation: 0 });
    }
    update({ total: book.spine.length });
    const initial = initialLocation?.kind === 'epub' ? locationLBP(initialLocation.lbp) : null;
    const index = Math.min(book.spine.length - 1, initial?.start.spineIndex ?? firstChapter());
    reveal(index);
    if (initialLocation?.kind === 'epub' && initialLocation.zoom) update({ scale: initialLocation.zoom, fitWidth: initialLocation.zoom === 1 });
    await load(index);
    if (!disposed) update({ busy: false });
  });
  void ready.catch(fail);
  const restoreLocation = async (location: ReadingLocation | null) => {
    const request = ++navigation;
    navigating = true; clearTimeout(positionTimer);
    try {
      await ready;
      if (disposed || request !== navigation) return;
      const value = location?.kind === 'epub' ? location : null;
      const position = locationLBP(value?.lbp ?? `${firstChapter()}@#0`)!;
      const index = Math.min(book!.spine.length - 1, position.start.spineIndex);
      reveal(index);
      const scale = value?.zoom ?? 1;
      update({ scale, fitWidth: scale === 1 });
      for (const view of views) if (view.frame?.contentDocument) { view.frame.contentDocument.documentElement.style.zoom = String(scale); view.measure?.(); }
      await load(index);
      if (disposed || request !== navigation) return;
      const view = views[index], root = view.frame?.contentDocument?.body;
      if (!root) return;
      view.measure?.();
      viewport.scrollTop = top(index) + Math.max(0, epubPositionTop(root, position) - 4);
      lastLocation = value;
      refreshVisible(index);
    } catch (error) { if (!disposed && request === navigation) fail(error); }
    finally { if (request === navigation) { navigating = false; schedulePosition(); } }
  };
  // Start immediately so any subsequent navigation supersedes this restoration.
  void restoreLocation(initialLocation ?? null);
  const goToLink = async (target: EpubLink) => {
    const request = ++navigation;
    await ready;
    if (disposed || request !== navigation) return;
    const index = book!.spine.findIndex((item) => item.path === target.path);
    if (index < 0) throw new Error('Chapter not found');
    navigating = true;
    try {
      reveal(index);
      await load(index);
      if (disposed || request !== navigation) return;
      const view = views[index], doc = view.frame?.contentDocument;
      if (!doc) throw new Error('Chapter unavailable');
      view.measure?.();
      const anchor = target.fragment ? doc.getElementById(target.fragment) ?? [...doc.getElementsByName(target.fragment)][0] : undefined;
      viewport.scrollTop = top(index) + (anchor?.getBoundingClientRect().top ?? 0);
      refreshVisible(index);
    } finally { if (request === navigation) navigating = false; }
  };
  const controller: ReaderController = {
    restoreLocation,
    goTo(position) { if (book && Number.isFinite(position)) void goToLink({ path: book.spine[Math.max(0, Math.min(book.spine.length - 1, Math.trunc(position) - 1))].path, fragment: '' }).catch(fail); },
    async goToOutline(id) {
      await ready;
      if (disposed) return;
      const target = book?.destinations.get(id);
      if (!target) throw new Error('Outline destination unavailable');
      await goToLink(target);
    },
    zoomTo(scale, options) {
      if (!book || !Number.isFinite(scale)) return;
      const bounds = viewport.getBoundingClientRect();
      const origin = options?.origin ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
      const x = bounds.left + origin.x, y = bounds.top + origin.y;
      const view = views.find((item) => { const rect = item.frame?.getBoundingClientRect(); return rect && rect.top <= y && rect.bottom > y; }) ?? views[current()];
      const index = views.indexOf(view), frame = view.frame, doc = frame?.contentDocument;
      const frameBefore = frame?.getBoundingClientRect();
      const localX = x - (frameBefore?.left ?? 0), localY = y - (frameBefore?.top ?? 0);
      // Preserve a text position through reflow, rather than multiplying a scroll offset.
      const caretDoc = doc as (Document & { caretRangeFromPoint?(x: number, y: number): Range | null; caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null }) | undefined;
      let anchor: Range | Element | undefined = caretDoc?.caretRangeFromPoint?.(localX, localY) ?? undefined;
      if (!anchor && caretDoc?.caretPositionFromPoint) {
        const caret = caretDoc.caretPositionFromPoint(localX, localY);
        if (caret) { const range = caretDoc.createRange(); range.setStart(caret.offsetNode, caret.offset); range.collapse(true); anchor = range; }
      }
      anchor ??= doc?.elementFromPoint(localX, localY) ?? undefined;
      const before = anchor?.getBoundingClientRect();
      const fraction = before?.height ? Math.max(0, Math.min(1, (localY - before.top) / before.height)) : 0;
      const offset = viewport.scrollTop - top(index), oldScale = state.scale;
      update({ scale: Math.max(.1, Math.min(5, scale)), fitWidth: scale === 1 });
      for (const item of views) if (item.frame?.contentDocument) { item.frame.contentDocument.documentElement.style.zoom = String(state.scale); item.measure?.(); }
      const after = anchor?.getBoundingClientRect();
      if (frame && frameBefore && before && after) {
        viewport.scrollTop += frame.getBoundingClientRect().top + after.top + fraction * after.height - (frameBefore.top + before.top + fraction * before.height) - (options?.pan?.y ?? 0);
      } else viewport.scrollTop = top(index) + offset * state.scale / oldScale - (options?.pan?.y ?? 0);
      refreshVisible();
    },
    fitWidth() { controller.zoomTo(1); },
    unlock() {},
    destroy() {
      if (disposed) return; disposed = true; navigation++;
      clearTimeout(positionTimer); resize.disconnect(); cancelAnimationFrame(scrollFrame); viewport.removeEventListener('scroll', scroll);
      views.forEach(unload); content.replaceChildren(); content.classList.remove('epub-stage'); unsubscribe(); source.release();
    },
  };
  let width = viewport.clientWidth, height = viewport.clientHeight;
  const resize = new ResizeObserver(() => {
    if (width === viewport.clientWidth && height === viewport.clientHeight) return;
    width = viewport.clientWidth; height = viewport.clientHeight;
    views.forEach((view) => view.measure?.());
    if (!navigating && lastLocation) void restoreLocation(lastLocation);
  });
  resize.observe(viewport);
  return controller;
};
