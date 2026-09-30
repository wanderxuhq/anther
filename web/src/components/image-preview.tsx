import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { t } from '../i18n.ts';
import './image-preview.css';

type Point = { x: number; y: number };
const MAX_SCALE = 8;
const STEP = 1.25;

export function ImagePreview(props: { path: string; url: string }) {
  let viewport!: HTMLDivElement;
  const [status, setStatus] = createSignal<'loading' | 'loaded' | 'error'>('loading');
  const [natural, setNatural] = createSignal({ width: 0, height: 0 });
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [fit, setFit] = createSignal(true);
  const [manualScale, setManualScale] = createSignal(1);
  const [dragging, setDragging] = createSignal(false);
  const pointers = new Map<number, Point>();
  const fitScale = createMemo(() => {
    const image = natural(), area = size();
    return image.width && image.height && area.width && area.height
      ? Math.min(1, area.width / image.width, area.height / image.height) : 1;
  });
  // 超大图片也能完整适应窗口，不受通常的 5% 下限截断。
  const minScale = () => Math.min(0.05, fitScale());
  const scale = createMemo(() => fit() ? fitScale() : manualScale());
  const imageWidth = () => natural().width * scale();
  const imageHeight = () => natural().height * scale();
  const zoomLevel = () => status() === 'loaded' ? `${Math.round(scale() * 1000) / 10}%` : '—';
  const center = (): Point => ({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = viewport.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // 保持光标/双指中心指向同一图片像素；按钮缩放以可视区域中心为基准。
  function zoomTo(value: number, from = center(), to = from) {
    if (status() !== 'loaded') return;
    const next = Math.max(minScale(), Math.min(MAX_SCALE, value));
    const old = scale(), image = natural();
    const width = viewport.clientWidth, height = viewport.clientHeight;
    const x = (viewport.scrollLeft + from.x - Math.max(0, (width - image.width * old) / 2)) / old;
    const y = (viewport.scrollTop + from.y - Math.max(0, (height - image.height * old) / 2)) / old;
    batch(() => { setManualScale(next); setFit(false); });
    viewport.scrollLeft = x * next + Math.max(0, (viewport.clientWidth - image.width * next) / 2) - to.x;
    viewport.scrollTop = y * next + Math.max(0, (viewport.clientHeight - image.height * next) / 2) - to.y;
  }

  function fitWindow() {
    setFit(true);
    viewport.scrollLeft = viewport.scrollTop = 0;
  }

  const measure = () => setSize({ width: viewport.clientWidth, height: viewport.clientHeight });
  createEffect(() => {
    props.url;
    batch(() => { setStatus('loading'); setNatural({ width: 0, height: 0 }); setFit(true); setManualScale(1); setDragging(false); });
    pointers.clear();
    if (viewport) viewport.scrollLeft = viewport.scrollTop = 0;
  });

  onMount(() => {
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(viewport);
    window.addEventListener('resize', measure);
    const wheel = (e: WheelEvent) => {
      if (status() !== 'loaded') return;
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1);
      zoomTo(scale() * Math.exp(-delta * 0.002), localPoint(e));
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    onCleanup(() => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      viewport.removeEventListener('wheel', wheel);
    });
  });

  const pinch = () => {
    const [a, b] = [...pointers.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  function pointerDown(e: PointerEvent) {
    if (status() !== 'loaded' || e.button !== 0) return;
    e.preventDefault();
    viewport.focus({ preventScroll: true });
    pointers.set(e.pointerId, localPoint(e));
    viewport.setPointerCapture?.(e.pointerId);
    setDragging(true);
  }
  function pointerMove(e: PointerEvent) {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    const before = pointers.size >= 2 ? pinch() : undefined;
    const point = localPoint(e);
    pointers.set(e.pointerId, point);
    if (before) {
      const after = pinch();
      if (before.distance > 0 && after.distance > 0) zoomTo(scale() * after.distance / before.distance, before.center, after.center);
    } else {
      viewport.scrollLeft -= point.x - previous.x;
      viewport.scrollTop -= point.y - previous.y;
    }
  }
  function pointerEnd(e: PointerEvent) {
    pointers.delete(e.pointerId);
    setDragging(pointers.size > 0);
  }

  return (
    <section class="image-preview" aria-label={t('image.preview')}>
      <div class="image-preview-toolbar" role="toolbar" aria-label={t('image.zoomControls')}>
        <button class="icon-btn" disabled={status() !== 'loaded' || scale() <= minScale()} onClick={() => zoomTo(scale() / STEP)} title={t('image.zoomOut')} aria-label={t('image.zoomOut')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <output class="image-preview-scale" aria-label={t('image.zoomLevel', { level: zoomLevel() })}>{zoomLevel()}</output>
        <button class="icon-btn" disabled={status() !== 'loaded' || scale() >= MAX_SCALE} onClick={() => zoomTo(scale() * STEP)} title={t('image.zoomIn')} aria-label={t('image.zoomIn')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
        </button>
        <button class="icon-btn" disabled={status() !== 'loaded'} onClick={() => zoomTo(1)} title={t('image.actualSize')} aria-label={t('image.actualSize')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 9h6v6H9z" /></svg>
        </button>
        <button class="icon-btn" classList={{ active: fit() }} disabled={status() !== 'loaded'} onClick={fitWindow} title={t('image.fit')} aria-label={t('image.fit')} aria-pressed={fit()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1" /><path d="m8 9 4 6 4-6" /></svg>
        </button>
      </div>
      <div class="image-preview-viewport" ref={viewport} tabIndex={0} aria-label={t('image.preview')}
        classList={{ 'image-preview-dragging': dragging(), 'image-preview-pannable': imageWidth() > size().width || imageHeight() > size().height }}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
        onKeyDown={(e) => {
          if (e.ctrlKey || e.metaKey || e.altKey || status() !== 'loaded') return;
          if (e.key === '+' || e.key === '=') zoomTo(scale() * STEP);
          else if (e.key === '-') zoomTo(scale() / STEP);
          else if (e.key === '0') fitWindow();
          else if (e.key === '1') zoomTo(1);
          else return;
          e.preventDefault();
        }}>
        <Show when={status() !== 'loaded'}>
          <div class="image-preview-message" classList={{ 'image-preview-error': status() === 'error' }} role={status() === 'error' ? 'alert' : 'status'}>
            {status() === 'error' ? t('image.loadFailed') : t('loading')}
          </div>
        </Show>
        <div class="image-preview-stage" style={{ width: `${imageWidth()}px`, height: `${imageHeight()}px`, visibility: status() === 'loaded' ? 'visible' : 'hidden' }}>
          <img class="image-preview-image" src={props.url} alt={props.path} draggable={false}
            style={{ width: `${imageWidth()}px`, height: `${imageHeight()}px` }}
            onLoad={(e) => {
              batch(() => { setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }); setStatus('loaded'); });
              measure();
            }}
            onError={() => setStatus('error')} />
        </div>
      </div>
    </section>
  );
}
