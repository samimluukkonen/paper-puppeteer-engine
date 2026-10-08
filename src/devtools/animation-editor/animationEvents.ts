import type { AnimationClip, AnimationEvent } from '../../engine/AnimationClip.js';
import { ANIMATION_FORMAT_VERSION, parseAnimationClip } from '../../engine/externalData.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { equalEditorData, freezeData, isFullyFrozen } from '../shared/editorData.js';
import { type Milliseconds, type Seconds, toSeconds } from './timeUnits.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

type AnimationData = DeepReadonly<AnimationClip>;
type EventData = DeepReadonly<AnimationEvent>;

/** Opaque session identity, stored beside immutable event arrays, never in animation JSON. */
export interface AnimationEventRef {
  readonly id: symbol;
}

const emptyEvents: readonly EventData[] = Object.freeze([]);
const references = new WeakMap<readonly EventData[], readonly AnimationEventRef[]>();

export function getAnimationEvents(animation: AnimationData | null): readonly EventData[] {
  return animation?.events ?? emptyEvents;
}

export function getAnimationEventReferences(animation: AnimationData | null): readonly AnimationEventRef[] {
  const events = getAnimationEvents(animation);
  let refs = references.get(events);
  if (!refs || refs.length !== events.length) {
    refs = Object.freeze(events.map(() => Object.freeze({ id: Symbol('animation-event') })));
    references.set(events, refs);
  }
  return refs;
}

/** Exact authored milliseconds; same-time events are returned individually in authored order. */
export function getEventsAtTime(animation: AnimationData | null, time: Milliseconds): readonly EventData[] {
  return getAnimationEvents(animation).filter((event) => event.time === time);
}

export function findAnimationEvent(animation: AnimationData | null, ref: AnimationEventRef): EventData | undefined {
  const index = getAnimationEventReferences(animation).indexOf(ref);
  return index < 0 ? undefined : getAnimationEvents(animation)[index];
}

/** Own mutable inputs before sharing/freeze; preserve sidecar identities across this ownership boundary. */
function ownedAnimation(animation: AnimationData, rig: Rig): AnimationData {
  const source = getValidatedEditorAnimation(animation, rig);
  if (source !== animation && source.events) references.set(source.events, getAnimationEventReferences(animation));
  return freezeData(source);
}

function withEvents<Animation extends AnimationData>(
  animation: Animation,
  source: AnimationData,
  rig: Rig,
  entries: readonly { event: EventData; ref: AnimationEventRef }[],
): Animation {
  // The ordinary file validator rejects unsupported payloads/fields and owns JSON before freezing.
  // Validate before reading event times, including unsafe descriptors in supplied event records.
  const parsed = parseAnimationClip(
    { ...animation, version: ANIMATION_FORMAT_VERSION, tracks: {}, events: entries.map(({ event }) => event) },
    rig,
  );
  // Stable sorting retains relative order at equal times, including a newly appended event.
  const ordered = parsed
    .events!.map((event, index) => ({ event, ref: entries[index]!.ref }))
    .sort((a, b) => a.event.time - b.event.time);
  const ownedEvents = freezeData(ordered.map(({ event }) => event));
  references.set(ownedEvents, Object.freeze(ordered.map(({ ref }) => ref)));
  return freezeData(validateEditedAnimation({ ...animation, tracks: source.tracks, events: ownedEvents }, source, rig));
}

/** Central authored-data foundations. Returned snapshots can be installed as one dirty/history edit. */
export function addAnimationEvent<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  event: EventData,
): Animation {
  const source = ownedAnimation(animation, rig);
  const refs = getAnimationEventReferences(source);
  return withEvents(animation, source, rig, [
    ...getAnimationEvents(source).map((event, index) => ({ event, ref: refs[index]! })),
    { event, ref: Object.freeze({ id: Symbol('animation-event') }) },
  ]);
}

/** Replace actual schema fields; movement is an update of time. Omit data to remove a payload. */
export function updateAnimationEvent<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  ref: AnimationEventRef,
  event: EventData,
): Animation {
  const source = ownedAnimation(animation, rig);
  const previous = findAnimationEvent(source, ref);
  if (!previous) throw new Error('Cannot update a missing animation event.');
  // Validate even no-op input, including non-JSON payloads and extra serialized fields.
  const refs = getAnimationEventReferences(source);
  const next = withEvents(
    animation,
    source,
    rig,
    getAnimationEvents(source).map((entry, index) => ({
      event: refs[index] === ref ? event : entry,
      ref: refs[index]!,
    })),
  );
  // Selecting/releasing a marker or committing an unchanged field must not sort
  // a valid, originally unsorted event array into a new authored history entry.
  return equalEditorData(previous, event) || equalEditorData(animation, next) ? animation : next;
}

export function removeAnimationEvent<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  ref: AnimationEventRef,
): Animation {
  const source = ownedAnimation(animation, rig);
  const refs = getAnimationEventReferences(source);
  if (!refs.includes(ref)) return animation;
  return withEvents(
    animation,
    source,
    rig,
    getAnimationEvents(source).flatMap((event, index) => (refs[index] === ref ? [] : [{ event, ref: refs[index]! }])),
  );
}

export interface TimelineEventMarker {
  readonly ref: AnimationEventRef;
  readonly time: Seconds;
  readonly name: string;
  /** Same-time events stack vertically, retaining the exact shared X coordinate. */
  readonly stackIndex: number;
}

export interface EventTimelineTrack {
  readonly kind: 'events';
  readonly markers: readonly TimelineEventMarker[];
  readonly stackCount: number;
}

const tracks = new WeakMap<readonly EventData[], EventTimelineTrack>();

/** Dedicated event model, independent of bone/property rows and DOM/Phaser. */
export function buildEventTimelineTrack(animation: AnimationData | null): EventTimelineTrack {
  const events = getAnimationEvents(animation);
  const cached = tracks.get(events);
  if (cached) return cached;
  const refs = getAnimationEventReferences(animation);
  const counts = new Map<number, number>();
  const markers = [...events.entries()]
    .sort(([, a], [, b]) => a.time - b.time)
    .map(([index, event]) => {
      const stackIndex = counts.get(event.time) ?? 0;
      counts.set(event.time, stackIndex + 1);
      return Object.freeze({ ref: refs[index]!, time: toSeconds(event.time), name: event.name, stackIndex });
    });
  const track: EventTimelineTrack = Object.freeze({
    kind: 'events',
    markers: Object.freeze(markers),
    stackCount: [...counts.values()].reduce((maximum, count) => Math.max(maximum, count), 1),
  });
  if (isFullyFrozen(events)) tracks.set(events, track);
  return track;
}
