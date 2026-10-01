import type { ReaderController, ReaderState } from '../readers/types.ts';

/** Preview a pinch with a compositor transform; commit document layout only on release. */
export function bindReaderGestures(viewport: HTMLElement, content: HTMLElement, reader: ReaderController, state: () => ReaderState) {
  type Pinch = { ids: string; distance: number; x: number; y: number };
  type Gesture = {
    start: Pinch; scale: number; origin: { x: number; y: number };
    transform: string; transformOrigin: string; willChange: string; overflow: string;
    scrollLeft: number; scrollTop: number;
  };
  let gesture: Gesture | undefined, pending: Pinch | undefined, frame = 0;
  const sample = (touches: TouchList): Pinch | undefined => {
    const value = state();
    if (touches.length !== 2 || !value.canZoom || !value.total || value.busy || value.error || value.password) return;
    const [a, b] = Array.from(touches).sort((a, b) => a.identifier - b.identifier);
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (distance < 1) return;
    return { ids: `${a.identifier}:${b.identifier}`, distance, x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  };
  const targetScale = (active: Gesture, next: Pinch) => Math.max(0.1, Math.min(5, active.scale * next.distance / active.start.distance));
  const preview = () => {
    frame = 0;
    if (!gesture || !pending) return;
    const ratio = targetScale(gesture, pending) / gesture.scale;
    content.style.transform = `translate(${pending.x - gesture.start.x}px, ${pending.y - gesture.start.y}px) scale(${ratio})`;
  };
  const finish = (commit: boolean) => {
    cancelAnimationFrame(frame); frame = 0;
    const active = gesture, next = pending;
    gesture = pending = undefined;
    if (!active) return;
    content.style.transform = active.transform;
    content.style.transformOrigin = active.transformOrigin;
    content.style.willChange = active.willChange;
    viewport.style.overflow = active.overflow;
    viewport.scrollLeft = active.scrollLeft; viewport.scrollTop = active.scrollTop;
    if (commit && next) reader.zoomTo(targetScale(active, next), {
      origin: active.origin,
      pan: { x: next.x - active.start.x, y: next.y - active.start.y },
    });
  };
  const begin = (point: Pinch) => {
    const rect = viewport.getBoundingClientRect(), stage = content.getBoundingClientRect();
    gesture = {
      start: point, scale: state().scale, origin: { x: point.x - rect.left, y: point.y - rect.top },
      transform: content.style.transform, transformOrigin: content.style.transformOrigin,
      willChange: content.style.willChange, overflow: viewport.style.overflow,
      scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop,
    };
    // Freeze native scrolling while previewing, so neither scroll position nor layout drifts.
    viewport.style.overflow = 'hidden';
    content.style.transformOrigin = `${point.x - stage.left}px ${point.y - stage.top}px`;
    content.style.willChange = 'transform';
  };
  const start = (event: TouchEvent) => {
    finish(true);
    const point = sample(event.touches);
    if (point) { event.preventDefault(); begin(point); }
  };
  const move = (event: TouchEvent) => {
    const next = sample(event.touches);
    if (!next) { finish(false); return; }
    event.preventDefault();
    if (!gesture || gesture.start.ids !== next.ids) { finish(false); begin(next); return; }
    pending = next;
    if (!frame) frame = requestAnimationFrame(preview);
  };
  const end = (event: TouchEvent) => {
    finish(true);
    const point = sample(event.touches);
    if (point) begin(point);
  };
  const cancel = () => finish(false);
  viewport.addEventListener('touchstart', start, { passive: false });
  viewport.addEventListener('touchmove', move, { passive: false });
  viewport.addEventListener('touchend', end);
  viewport.addEventListener('touchcancel', cancel);
  return () => {
    cancel();
    viewport.removeEventListener('touchstart', start);
    viewport.removeEventListener('touchmove', move);
    viewport.removeEventListener('touchend', end);
    viewport.removeEventListener('touchcancel', cancel);
  };
}
