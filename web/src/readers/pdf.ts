import { AnnotationMode, AnnotationEditorType, getDocument, GlobalWorkerOptions, PasswordResponses, version, type PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFViewer, PDFLinkService, LinkTarget } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { ReaderFactory, ReaderOutlineItem } from './types.ts';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdf.css';

const assets = `/pdfjs/${version}/`;
GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.mjs`;

/** PDF.js owns continuous page layout, text/links, render scheduling and page eviction. */
export const createPdfReader: ReaderFactory = ({ url, viewport, content, onState }) => {
  let disposed = false, pdf: PDFDocumentProxy | undefined;
  let unlock: ((password: string) => void) | undefined;
  const destinations = new Map<string, string | unknown[]>();
  let navigation = 0, resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const lifetime = new AbortController(), events = new EventBus();
  const links = new PDFLinkService({ eventBus: events, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer' });
  content.classList.add('pdfViewer');
  const viewer = new PDFViewer({
    container: viewport, viewer: content, eventBus: events, linkService: links,
    annotationMode: AnnotationMode.ENABLE, annotationEditorMode: AnnotationEditorType.DISABLE,
    maxCanvasPixels: 16_777_216, maxCanvasDim: 8192,
    imageResourcesPath: `${assets}images/`, ...{ abortSignal: lifetime.signal },
  });
  links.setViewer(viewer);
  onState({ canZoom: true, canFitWidth: true, outlineStatus: 'loading' });
  const update: typeof onState = (state) => { if (!disposed) onState(state); };
  events.on('pagesinit', () => { viewer.currentScaleValue = 'page-width'; resolveReady(); });
  events.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => update({ position: pageNumber }));
  events.on('scalechanging', ({ scale, presetValue }: { scale: number; presetValue?: string }) => update({ scale, fitWidth: presetValue === 'page-width' }));
  events.on('pagerendered', ({ error }: { error?: Error }) => update({ busy: false, ...(error ? { error: 'loadFailed' as const } : {}) }));
  let resizeFrame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (disposed || !pdf) return;
      if (viewer.currentScaleValue === 'page-width') viewer.currentScaleValue = 'page-width';
      viewer.update();
    });
  });
  observer.observe(viewport);

  const loading = getDocument({
    url, cMapUrl: `${assets}cmaps/`, standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`,
    disableStream: true, disableAutoFetch: true,
  });
  loading.onPassword = (callback: (password: string) => void, reason: number) => {
    unlock = callback;
    update({ busy: false, password: reason === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required' });
  };
  void loading.promise.then((document) => {
    if (disposed) return;
    pdf = document; update({ total: document.numPages });
    links.setDocument(document); viewer.setDocument(document);
    void document.getOutline().then((outline) => {
      if (disposed) return;
      const convert = (items: NonNullable<typeof outline>, prefix = ''): ReaderOutlineItem[] => items.map((item, index) => {
        const id = `${prefix}${index}`;
        const destination = item.dest;
        const navigable = typeof destination === 'string' || Array.isArray(destination);
        if (navigable) destinations.set(id, destination);
        return { id, title: item.title, navigable, children: convert(item.items, `${id}.`) };
      });
      update({ outline: convert(outline ?? []), outlineStatus: 'ready' });
    }).catch(() => update({ outlineStatus: 'error' }));
  }).catch(() => update({ error: 'loadFailed', busy: false, outlineStatus: 'error' }));

  return {
    goTo(position) {
      if (pdf && Number.isFinite(position)) viewer.currentPageNumber = Math.max(1, Math.min(pdf.numPages, Math.trunc(position)));
    },
    async goToOutline(id) {
      if (disposed || !pdf) return;
      const request = ++navigation, document = pdf;
      const target = destinations.get(id);
      const destination = typeof target === 'string' ? await document.getDestination(target) : target;
      if (disposed) return;
      if (!Array.isArray(destination)) throw new Error('Outline destination unavailable');
      const reference = destination[0];
      const index = reference && typeof reference === 'object' ? await document.getPageIndex(reference) : reference;
      if (!Number.isInteger(index) || index < 0 || index >= document.numPages) throw new Error('Outline page unavailable');
      await ready;
      if (disposed || request !== navigation) return;
      // Resolve references before navigating so a slower earlier click cannot win.
      await links.goToDestination([index, ...destination.slice(1)]);
    },
    zoomTo(scale, options) {
      if (!pdf || !Number.isFinite(scale)) return;
      const origin = options?.origin ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
      const bounds = viewport.getBoundingClientRect();
      const x = bounds.left + origin.x, y = bounds.top + origin.y;
      const hit = viewport.ownerDocument.elementFromPoint(x, y)?.closest<HTMLElement>('.page');
      const page: HTMLElement | undefined = hit && content.contains(hit) ? hit : viewer.getPageView(viewer.currentPageNumber - 1)?.div;
      const before = page?.getBoundingClientRect();
      viewer.updateScale({ scaleFactor: Math.max(0.1, Math.min(5, scale)) / viewer.currentScale,
        origin: [viewport.offsetLeft + origin.x, viewport.offsetTop + origin.y],
        pan: options?.pan ? [options.pan.x, options.pan.y] : undefined,
      });
      // A large committed zoom changes centered-page margins too. Preserve the actual
      // point on the page, rather than assuming the entire scroll area scales uniformly.
      if (page && before?.width && before.height) {
        const after = page.getBoundingClientRect();
        viewport.scrollLeft += after.left + (x - before.left) / before.width * after.width - x - (options?.pan?.x ?? 0);
        viewport.scrollTop += after.top + (y - before.top) / before.height * after.height - y - (options?.pan?.y ?? 0);
      }
    },
    fitWidth() { if (pdf) viewer.currentScaleValue = 'page-width'; },
    unlock(password) { update({ password: null, busy: true }); unlock?.(password); },
    destroy() {
      if (disposed) return;
      disposed = true; resolveReady(); lifetime.abort(); observer.disconnect(); cancelAnimationFrame(resizeFrame);
      // PDF.js accepts null to release pages/listeners; its declaration omits this cleanup case.
      // @ts-expect-error Supported by PDFViewer.setDocument at runtime.
      viewer.setDocument(null);
      links.setDocument(null); content.classList.remove('pdfViewer');
      destinations.clear();
      void loading.destroy().catch(() => {});
    },
  };
};
