import type { ReaderController, ReaderState } from '../readers/types.ts';

/** Preview a pinch with a compositor transform; commit document layout only on release. */
export function bindReaderGestures(viewport: HTMLElement, content: HTMLElement, reader: ReaderController, state: () => ReaderState, input?: { target: EventTarget; toClient(x: number, y: number): { x: number; y: number } }) {
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
    const point = (touch: Touch) => input?.toClient(touch.clientX, touch.clientY) ?? { x: touch.clientX, y: touch.clientY };
    const first = point(a), second = point(b);
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    if (distance < 1) return;
    return { ids: `${a.identifier}:${b.identifier}`, distance, x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
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
  const target = (input?.target ?? viewport) as HTMLElement;
  target.addEventListener('touchstart', start, { passive: false });
  target.addEventListener('touchmove', move, { passive: false });
  target.addEventListener('touchend', end);
  target.addEventListener('touchcancel', cancel);
  return () => {
    cancel();
    target.removeEventListener('touchstart', start);
    target.removeEventListener('touchmove', move);
    target.removeEventListener('touchend', end);
    target.removeEventListener('touchcancel', cancel);
  };
}
