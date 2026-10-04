import type { MediaPosition } from './preview-state.ts';

/** Media lifecycle adapter, independent of UI framework, files and URL storage. */
export function bindMediaPosition(media: HTMLMediaElement, notify: (position: MediaPosition) => void) {
  let desired: MediaPosition | null = null, restoring = true, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    if (disposed || restoring || media.seeking || media.readyState < 1) return;
    notify({ kind: 'media', time: Math.round(media.currentTime * 1000) / 1000,
      ...(media.playbackRate === 1 ? {} : { rate: media.playbackRate }) });
  };
  const apply = () => {
    if (disposed || media.readyState < 1) return;
    const duration = media.duration;
    const time = Math.max(0, Math.min(desired?.time ?? 0, Number.isFinite(duration) ? duration : Infinity));
    media.playbackRate = desired?.rate ?? 1;
    if (Math.abs(media.currentTime - time) > .01) { media.currentTime = time; return; }
    restoring = false;
  };
  const seeked = () => { restoring = false; publish(); };
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = undefined; publish(); }, 500); };
  const metadata = () => { if (restoring) apply(); };
  media.addEventListener('loadedmetadata', metadata);
  media.addEventListener('durationchange', metadata);
  media.addEventListener('seeked', seeked);
  media.addEventListener('timeupdate', schedule);
  media.addEventListener('pause', publish);
  media.addEventListener('ratechange', publish);
  return {
    restore(position: MediaPosition | null) { restoring = true; desired = position; clearTimeout(timer); timer = undefined; media.pause(); apply(); },
    dispose() {
      disposed = true; clearTimeout(timer);
      media.removeEventListener('loadedmetadata', metadata); media.removeEventListener('durationchange', metadata);
      media.removeEventListener('seeked', seeked); media.removeEventListener('timeupdate', schedule);
      media.removeEventListener('pause', publish); media.removeEventListener('ratechange', publish);
    },
  };
}
