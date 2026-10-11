import { interpolateNumber, shortestRotationDelta } from './animationMath.js';
import { ikAnimationProperties, type IKAnimationProperty, type IKKeyframe } from './ik/animationKeyframes.js';
import { copyJsonData } from './jsonData.js';
import { freezeData, isFullyFrozen, readonlyMap } from './readonlyData.js';
import type { Rig } from './Rig.js';
import { animationClipSchema, identifierSchema, ikKeyframeSchema, keyframeSchema } from './schemas.js';
import type { JointTransform, TransformProperty } from './types.js';
import { assertFinite, transformProperties } from './types.js';
import { checkAnimationReferences, throwValidationIssue } from './validation.js';

/** Version 1 supports linear segments only. Smooth/stepped describe playback sample timing. */
export type Interpolation = 'linear';

export interface Keyframe extends Partial<JointTransform> {
  /** Milliseconds from the start of the clip. Values are absolute local poses. */
  time: number;
}

export interface AnimationClip {
  name: string;
  duration: number;
  loop: boolean;
  /** Optional clip-level declaration; omitting it also uses linear interpolation. No per-key/track overrides. */
  interpolation?: Interpolation;
  tracks: Readonly<Record<string, readonly Keyframe[]>>;
  /** Constraint-name keyed sparse rows. Positions are puppet-local, before placement/facing/scale. */
  ikTracks?: Readonly<Record<string, readonly IKKeyframe[]>>;
  events?: readonly AnimationEvent[];
  playback?: AnimationPlaybackMode;
}

export interface AnimationEvent {
  time: number;
  name: string;
  /** JSON payloads are copied at ownership boundaries; other runtime values retain reference semantics. */
  data?: unknown;
}

/** Keep JSON event data independent without rejecting arbitrary TypeScript runtime payloads. */
export function copyAnimationEvent<Event extends AnimationEvent>(event: Event): Event {
  return Object.hasOwn(event, 'data') ? { ...event, data: copyJsonData(event.data) } : { ...event };
}

/** Smooth samples continuous time; stepped quantizes time before evaluating the same linear segments. */
export type AnimationPlaybackMode = { mode: 'smooth' } | { mode: 'stepped'; fps: number };

export interface PropertyKeyframe {
  readonly time: number;
  readonly value: number;
}

export interface CompiledTrack {
  readonly bone: string;
  readonly properties: ReadonlyMap<TransformProperty, readonly PropertyKeyframe[]>;
}

export interface CompiledIKTrack {
  readonly constraint: string;
  readonly properties: ReadonlyMap<IKAnimationProperty, readonly PropertyKeyframe[]>;
}

export interface CompiledClip {
  readonly name: string;
  readonly duration: number;
  readonly loop: boolean;
  readonly tracks: readonly CompiledTrack[];
  readonly ikTracks?: readonly CompiledIKTrack[];
  readonly events: readonly Readonly<AnimationEvent>[];
  readonly playback?: Readonly<AnimationPlaybackMode>;
}

const ownedClips = new WeakSet<CompiledClip>();
const ownedTracks = new WeakSet<CompiledTrack>();
const ownedIKTracks = new WeakSet<CompiledIKTrack>();
const compiledIKProperties = new WeakMap<readonly IKKeyframe[], CompiledIKTrack['properties']>();
const compiledProperties = new WeakMap<readonly Keyframe[], CompiledTrack['properties']>();

function ownCompiledTrack(track: CompiledTrack): CompiledTrack {
  if (ownedTracks.has(track)) return track;
  const owned = Object.freeze({
    bone: track.bone,
    properties: readonlyMap(
      [...track.properties].map(
        ([property, keys]) =>
          [property, Object.freeze(keys.map((key) => Object.freeze({ time: key.time, value: key.value })))] as const,
      ),
    ),
  });
  ownedTracks.add(owned);
  return owned;
}

function ownCompiledIKTrack(track: CompiledIKTrack): CompiledIKTrack {
  if (ownedIKTracks.has(track)) return track;
  const owned = Object.freeze({
    constraint: track.constraint,
    properties: readonlyMap(
      [...track.properties].map(
        ([property, keys]) =>
          [property, Object.freeze(keys.map((key) => Object.freeze({ time: key.time, value: key.value })))] as const,
      ),
    ),
  });
  ownedIKTracks.add(owned);
  return owned;
}

/** @internal Share compiler-owned immutable clips; snapshot externally assembled compiled data. */
export function ownCompiledClip(clip: CompiledClip): CompiledClip {
  if (ownedClips.has(clip)) return clip;
  const metadata = animationClipSchema.parse({ ...clip, tracks: {}, ikTracks: {} });
  checkAnimationReferences(metadata, { bones: [] }, throwValidationIssue);
  const bones = new Set<string>();
  for (const track of clip.tracks) {
    identifierSchema.parse(track.bone);
    if (bones.has(track.bone)) throw new Error(`Duplicate compiled track for bone "${track.bone}".`);
    bones.add(track.bone);
    for (const [property, keys] of track.properties) {
      if (!transformProperties.includes(property)) throw new Error(`Unknown compiled property "${property}".`);
      if (!keys.length) throw new Error(`Compiled property "${track.bone}.${property}" needs at least one key.`);
      const authoredKeys = keys.map((key) => {
        assertFinite(key.value, `Compiled property ${track.bone}.${property}`);
        return keyframeSchema.parse({ time: key.time, [property]: key.value });
      });
      // Reuse authored timeline rules for each independently compiled property.
      checkAnimationReferences(
        { ...metadata, tracks: { [track.bone]: authoredKeys }, events: [] },
        { bones: [{ id: track.bone }] },
        throwValidationIssue,
      );
    }
  }
  const constraints = new Set<string>();
  for (const track of clip.ikTracks ?? []) {
    identifierSchema.parse(track.constraint);
    if (constraints.has(track.constraint)) throw new Error(`Duplicate compiled IK track "${track.constraint}".`);
    constraints.add(track.constraint);
    for (const [property, keys] of track.properties) {
      if (!ikAnimationProperties.includes(property)) throw new Error(`Unknown compiled IK property "${property}".`);
      if (!keys.length)
        throw new Error(`Compiled IK property "${track.constraint}.${property}" needs at least one key.`);
      const authoredKeys = keys.map((key) => ikKeyframeSchema.parse({ time: key.time, [property]: key.value }));
      checkAnimationReferences(
        { ...metadata, ikTracks: { [track.constraint]: authoredKeys }, events: [] },
        undefined,
        throwValidationIssue,
      );
    }
  }
  return snapshotCompiledClip(clip);
}

/** Compiler output has already passed scalar and timeline validation. */
function snapshotCompiledClip(clip: CompiledClip): CompiledClip {
  const owned: CompiledClip = Object.freeze({
    name: clip.name,
    duration: clip.duration,
    loop: clip.loop,
    tracks: Object.freeze(clip.tracks.map(ownCompiledTrack)),
    ...(clip.ikTracks ? { ikTracks: Object.freeze(clip.ikTracks.map(ownCompiledIKTrack)) } : {}),
    events: Object.freeze(
      clip.events.map((event) => {
        const copy = copyAnimationEvent(event);
        // JSON data is owned and can be frozen. Arbitrary runtime payloads keep reference semantics.
        if (copy.data !== event.data) freezeData(copy.data);
        return Object.freeze(copy);
      }),
    ),
    ...(clip.playback ? { playback: Object.freeze({ ...clip.playback }) } : {}),
  });
  ownedClips.add(owned);
  return owned;
}

/** Compile sparse keys per property once rather than searching them every frame. */
export function compileClip(clip: AnimationClip, rig: Rig): CompiledClip {
  if (!rig) throw new Error('Animation compilation requires a rig.');
  clip = animationClipSchema.parse(clip);
  checkAnimationReferences(clip, rig, throwValidationIssue);
  return compileValidatedClip(clip);
}

/** @internal Compile data that has already passed shape and rig-reference validation. */
export function compileValidatedClip(clip: AnimationClip): CompiledClip {
  const events = [...(clip.events ?? [])].sort((a, b) => a.time - b.time);
  const tracks: CompiledTrack[] = [];
  for (const [bone, keys] of Object.entries(clip.tracks)) {
    const cached = compiledProperties.get(keys);
    if (cached) {
      const track = Object.freeze({ bone, properties: cached });
      ownedTracks.add(track);
      tracks.push(track);
      continue;
    }
    const properties = new Map<TransformProperty, readonly PropertyKeyframe[]>();
    for (const property of transformProperties) {
      const samples: PropertyKeyframe[] = [];
      for (const key of keys) {
        const value = key[property];
        if (value !== undefined) samples.push({ time: key.time, value });
      }
      if (samples.length > 0) properties.set(property, samples);
    }
    const track = ownCompiledTrack({ bone, properties });
    if (isFullyFrozen(keys)) compiledProperties.set(keys, track.properties);
    tracks.push(track);
  }
  const ikTracks: CompiledIKTrack[] = [];
  for (const [constraint, keys] of Object.entries(clip.ikTracks ?? {})) {
    const cached = compiledIKProperties.get(keys);
    const properties = new Map<IKAnimationProperty, readonly PropertyKeyframe[]>();
    if (!cached) {
      for (const property of ikAnimationProperties) {
        const samples = keys.flatMap((key) =>
          key[property] === undefined ? [] : [{ time: key.time, value: key[property] }],
        );
        if (samples.length) properties.set(property, samples);
      }
    }
    const track = ownCompiledIKTrack({ constraint, properties: cached ?? properties });
    if (isFullyFrozen(keys)) compiledIKProperties.set(keys, track.properties);
    ikTracks.push(track);
  }
  return snapshotCompiledClip({
    name: clip.name,
    duration: clip.duration,
    loop: clip.loop,
    tracks,
    ...(clip.ikTracks ? { ikTracks } : {}),
    events,
    ...(clip.playback ? { playback: { ...clip.playback } } : {}),
  });
}

export function sampleProperty(keys: readonly PropertyKeyframe[], time: number, property?: TransformProperty): number {
  const first = keys[0];
  if (!first) throw new Error('Cannot sample an empty property track.');
  if (time <= first.time) return first.value;
  // Find the first key at or after time, including exact keys for angular interpolation.
  // This also supports backward scrubbing without a mutable playback cursor.
  let low = 1;
  let high = keys.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (time <= keys[middle]!.time) high = middle;
    else low = middle + 1;
  }
  const next = keys[low];
  if (!next) return keys[keys.length - 1]!.value;
  const previous = keys[low - 1]!;
  const progress = (time - previous.time) / (next.time - previous.time);
  if (property === 'rotation') {
    return previous.value + shortestRotationDelta(previous.value, next.value) * progress;
  }
  return interpolateNumber(previous.value, next.value, progress);
}
