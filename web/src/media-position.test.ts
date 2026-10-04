import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindMediaPosition } from './media-position.ts';

class Media extends EventTarget {
  readyState = 0; currentTime = 0; duration = 20; playbackRate = 1; seeking = false; paused = false;
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  event(type: string) { this.dispatchEvent(new Event(type)); }
}

test('media restoration waits for metadata, uses the latest target, clamps duration and never plays', () => {
  const media = new Media(), positions: unknown[] = [];
  const binding = bindMediaPosition(media as unknown as HTMLMediaElement, (position) => positions.push(position));
  binding.restore({ kind: 'media', time: 3, rate: 2 });
  binding.restore({ kind: 'media', time: 50, rate: 1.5 });
  assert.equal(media.currentTime, 0); assert.equal(positions.length, 0);
  media.readyState = 1; media.event('loadedmetadata');
  assert.equal(media.currentTime, 20); assert.equal(media.playbackRate, 1.5); assert(media.paused);
  media.event('seeked'); assert.deepEqual(positions.at(-1), { kind: 'media', time: 20, rate: 1.5 });
  binding.restore(null); assert.equal(media.currentTime, 0); assert.equal(media.playbackRate, 1);
  media.event('seeked'); assert.deepEqual(positions.at(-1), { kind: 'media', time: 0 });
  binding.dispose();
  const count = positions.length; media.currentTime = 5; media.event('seeked'); media.pause();
  assert.equal(positions.length, count);
});
