import type { AnimationEvent, CompiledClip } from './AnimationClip.js';
import { jsonDataCopyWork } from './jsonData.js';
import { assertFinite } from './types.js';

export const MAXIMUM_ANIMATION_EVENTS_PER_UPDATE = 10_000;
export const MAXIMUM_ANIMATION_EVENT_PAYLOAD_WORK = 1_000_000;

/** One operation budgets all layers, loop crossings and per-listener JSON copies before mutation. */
export class AnimationEventBudget {
  private count = 0;
  private payloadWork = 0;

  constructor(private readonly operation: 'update' | 'start' | 'restart' = 'update') {}

  addEvent(event: AnimationEvent, occurrences = 1, listeners = 1): void {
    if (occurrences <= 0) return;
    this.count += occurrences;
    assertAnimationEventBudget(this.count, this.operation);
    this.payloadWork += occurrences * Math.max(1, listeners) * jsonDataCopyWork(event.data);
    if (this.payloadWork > MAXIMUM_ANIMATION_EVENT_PAYLOAD_WORK)
      throw new Error(
        `Animation ${this.operation} exceeds the ${MAXIMUM_ANIMATION_EVENT_PAYLOAD_WORK}-unit event payload copy budget. Reduce payload sizes, listeners, or catch-up work.`,
      );
  }

  addStartEvents(clip: CompiledClip, listeners = 1): void {
    for (const event of clip.events) if (event.time === 0) this.addEvent(event, 1, listeners);
  }

  addCrossings(clip: CompiledClip, previous: number, end: number, listeners = 1): void {
    if (end === previous) return;
    for (const event of clip.events) {
      const [first, last] = eventCycles(clip, previous, end, event.time);
      this.addEvent(event, Math.max(0, last - first + 1), listeners);
    }
  }
}

export function countAnimationStartEvents(clip: CompiledClip): number {
  return clip.events.reduce((count, marker) => count + Number(marker.time === 0), 0);
}

/** Runtime start/restart convention, separate from the exclusive lower bound used by crossings. */
export function collectAnimationStartEvents(clip: CompiledClip, layer: string, listeners = 1) {
  new AnimationEventBudget('start').addStartEvents(clip, listeners);
  return clip.events.filter((marker) => marker.time === 0).map((marker) => ({ ...marker, clip: clip.name, layer }));
}

export function assertAnimationEventBudget(count: number, operation: 'update' | 'start' | 'restart' = 'update'): void {
  if (count > MAXIMUM_ANIMATION_EVENTS_PER_UPDATE)
    throw new Error(
      `Animation ${operation} exceeds ${MAXIMUM_ANIMATION_EVENTS_PER_UPDATE} events. ${operation === 'update' ? 'Reduce the delta or playback speed.' : 'Reduce time-zero markers or selected layers.'}`,
    );
}

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

function assertSafeCycle(cycle: number): void {
  if (!Number.isSafeInteger(cycle))
    throw new Error('Animation event cycle bounds must be safe integers. Reduce the delta or playback speed.');
}

/** Correct the division estimate against the same representable crossing used for delivery. */
function lastEventCycle(duration: number, boundary: number, time: number): number {
  let cycle = Math.floor((boundary - time) / duration);
  assertSafeCycle(cycle);
  while (cycle >= 0 && cycle * duration + time > boundary) --cycle;
  while ((cycle + 1) * duration + time <= boundary) {
    ++cycle;
    assertSafeCycle(cycle);
  }
  return cycle;
}

function eventCycles(clip: CompiledClip, previous: number, end: number, time: number): [number, number] {
  if (!clip.loop) return time > previous && time <= end ? [0, 0] : [1, 0];
  const first = Math.max(0, lastEventCycle(clip.duration, previous, time) + 1);
  const last = lastEventCycle(clip.duration, end, time);
  assertSafeCycle(first);
  return [first, last];
}

/** Retain an exact authored boundary after wrapping so the next update cannot replay it. */
export function wrapAnimationTime(clip: Pick<CompiledClip, 'duration' | 'events'>, end: number): number {
  if (end < clip.duration) return end;
  const wrapped = end % clip.duration;
  let cycle = Math.floor(end / clip.duration);
  if (!Number.isSafeInteger(cycle)) return wrapped;
  while (cycle * clip.duration > end) --cycle;
  while (Number.isSafeInteger(cycle + 1) && (cycle + 1) * clip.duration <= end) ++cycle;
  const start = cycle * clip.duration;
  let boundaryTime: number | undefined = start === end ? 0 : undefined;
  for (const marker of clip.events) {
    // A tail marker from the previous cycle may round to the same absolute time as zero.
    // Only current-cycle markers may advance the wrapped phase beyond that boundary.
    if (marker.time < clip.duration && start + marker.time === end)
      boundaryTime = Math.max(boundaryTime ?? 0, marker.time);
  }
  return boundaryTime ?? wrapped;
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
