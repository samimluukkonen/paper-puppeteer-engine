import type { AnimationEvent, CompiledClip } from './AnimationClip.js';
import { assertFinite } from './types.js';

interface AnimationClock {
  readonly clip: Pick<CompiledClip, 'duration' | 'loop'>;
  readonly time: number;
  readonly speed: number;
}

/** Calculate an absolute end time without mutating the clock or wrapping loops. */
export function advanceAnimationTime(state: AnimationClock, delta: number, playbackSpeed: number): number {
  if (delta === 0 || playbackSpeed === 0 || state.speed === 0) return state.time;
  const distance = delta * playbackSpeed * state.speed;
  assertFinite(distance, 'Animation advancement distance');
  const end = state.time + distance;
  assertFinite(end, 'Animation advancement time');
  return state.clip.loop ? end : Math.min(end, state.clip.duration);
}

function eventCycles(clip: CompiledClip, previous: number, end: number, time: number): [number, number] {
  if (!clip.loop) return time > previous && time <= end ? [0, 0] : [1, 0];
  const first = Math.max(0, Math.floor((previous - time) / clip.duration) + 1);
  const last = Math.floor((end - time) / clip.duration);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last))
    throw new Error('Animation event cycle bounds must be safe integers. Reduce the delta or playback speed.');
  return [first, last];
}

/** Count catch-up work before allocating events or changing any layer clocks. */
export function countAnimationEvents(clip: CompiledClip, previous: number, end: number): number {
  if (end === previous) return 0;
  let count = 0;
  for (const marker of clip.events) {
    const [first, last] = eventCycles(clip, previous, end, marker.time);
    count += Math.max(0, last - first + 1);
  }
  return count;
}

/** Collect crossings in timeline order after the player has bounded total catch-up work. */
export function collectAnimationEvents(
  clip: CompiledClip,
  previous: number,
  end: number,
  layer: string,
): (AnimationEvent & { clip: string; layer: string })[] {
  if (end === previous) return [];
  const crossed: { time: number; marker: AnimationEvent }[] = [];
  for (const marker of clip.events) {
    const [first, last] = eventCycles(clip, previous, end, marker.time);
    for (let cycle = first; cycle <= last; cycle += 1) {
      const crossing = cycle * clip.duration + marker.time;
      if (crossing > previous && crossing <= end) crossed.push({ time: crossing, marker });
    }
  }
  crossed.sort((a, b) => a.time - b.time);
  return crossed.map(({ marker }) => ({ ...marker, clip: clip.name, layer }));
}
