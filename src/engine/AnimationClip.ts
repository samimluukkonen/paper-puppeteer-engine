import {
  copyPropertyCurve,
  evaluateCurveProgress,
  propertyKeyframe,
  type PropertyCurve,
  type PropertyCurves,
} from './animationCurves.js';
import { interpolateNumber, shortestRotationDelta } from './animationMath.js';
import { ikAnimationProperties, type IKAnimationProperty, type IKKeyframe } from './ik/animationKeyframes.js';
import { copyJsonData } from './jsonData.js';
import type { MeshDeformationTracks } from './meshDeformation.js';
import { freezeData, isFullyFrozen, readonlyMap } from './readonlyData.js';
import type { Rig } from './Rig.js';
import type { RootMotionDefinition } from './rootMotion.js';
import { animationClipSchema, identifierSchema, ikKeyframeSchema, keyframeSchema } from './schemas.js';
import type { JointTransform, TransformProperty } from './types.js';
import { assertFinite, transformProperties } from './types.js';
import { checkAnimationReferences, throwValidationIssue } from './validation.js';

/** Clip-wide default. Optional per-property curves override individual outgoing segments. */
export type Interpolation = 'linear';

export interface Keyframe extends Partial<JointTransform> {
  /** Milliseconds from the start of the clip. Values are absolute local poses. */
  time: number;
  curves?: PropertyCurves<TransformProperty>;
}

export interface AnimationLibraryMetadata {
  displayName?: string;
  description?: string;
  tags?: readonly string[];
}

export interface AnimationClip {
  /** Optional artist labels; name remains the stable runtime asset ID. */
  library?: AnimationLibraryMetadata;
  name: string;
  duration: number;
  loop: boolean;
  /** Optional clip-level default; omitting it also uses linear interpolation. */
  interpolation?: Interpolation;
  tracks: Readonly<Record<string, readonly Keyframe[]>>;
  /** Authored animation-local X/Y offsets. Pose evaluation never applies these to placement. */
  rootMotion?: RootMotionDefinition;
  deformationTracks?: MeshDeformationTracks;
  /** Constraint-name keyed sparse rows. Positions are puppet-local, before placement/facing/scale. */
  ikTracks?: Readonly<Record<string, readonly IKKeyframe[]>>;
  /** Clip-local suppression, including runtime targets/providers; absent means ordinary rig IK. */
  disabledIKConstraints?: readonly string[];
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

/** Smooth samples continuous time; stepped quantizes time before evaluating property segments. */
export type AnimationPlaybackMode = { mode: 'smooth' } | { mode: 'stepped'; fps: number };

export interface PropertyKeyframe {
  readonly time: number;
  readonly value: number;
  readonly curve?: PropertyCurve;
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
  readonly rootMotion?: RootMotionDefinition;
  readonly deformationTracks?: MeshDeformationTracks;
  readonly ikTracks?: readonly CompiledIKTrack[];
  readonly disabledIKConstraints?: readonly string[];
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
        ([property, keys]) => [property, Object.freeze(keys.map(copyCompiledKeyframe))] as const,
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
        ([property, keys]) => [property, Object.freeze(keys.map(copyCompiledKeyframe))] as const,
      ),
    ),
  });
  ownedIKTracks.add(owned);
  return owned;
}

function copyCompiledKeyframe(key: PropertyKeyframe): PropertyKeyframe {
  return freezeData({
    time: key.time,
    value: key.value,
    ...(key.curve ? { curve: copyPropertyCurve(key.curve) } : {}),
  });
}

/** @internal Share compiler-owned immutable clips; snapshot externally assembled compiled data. */
export function ownCompiledClip(clip: CompiledClip): CompiledClip {
  if (ownedClips.has(clip)) return clip;
  const metadata = animationClipSchema.parse({ ...clip, tracks: {}, ikTracks: {} });
  checkAnimationReferences(metadata, undefined, throwValidationIssue);
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
        return keyframeSchema.parse({
          time: key.time,
          [property]: key.value,
          ...(key.curve !== undefined ? { curves: { [property]: key.curve } } : {}),
        });
      });
      // Reuse authored timeline rules for each independently compiled property.
      checkAnimationReferences(
        {
          ...metadata,
          deformationTracks: {},
          disabledIKConstraints: [],
          tracks: { [track.bone]: authoredKeys },
          events: [],
        },
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
      const authoredKeys = keys.map((key) =>
        ikKeyframeSchema.parse({
          time: key.time,
          [property]: key.value,
          ...(key.curve !== undefined ? { curves: { [property]: key.curve } } : {}),
        }),
      );
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
    ...(clip.rootMotion
      ? {
          rootMotion: freezeData({
            translationKeys: clip.rootMotion.translationKeys.map((key) => ({
              time: key.time,
              ...(key.x === undefined ? {} : { x: key.x }),
              ...(key.y === undefined ? {} : { y: key.y }),
              ...(key.curves === undefined
                ? {}
                : {
                    curves: {
                      ...(key.curves.x ? { x: copyPropertyCurve(key.curves.x) } : {}),
                      ...(key.curves.y ? { y: copyPropertyCurve(key.curves.y) } : {}),
                    },
                  }),
            })),
          }),
        }
      : {}),
    ...(clip.deformationTracks ? { deformationTracks: freezeData(structuredClone(clip.deformationTracks)) } : {}),
    ...(clip.ikTracks ? { ikTracks: Object.freeze(clip.ikTracks.map(ownCompiledIKTrack)) } : {}),
    ...(clip.disabledIKConstraints ? { disabledIKConstraints: Object.freeze([...clip.disabledIKConstraints]) } : {}),
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
        if (value !== undefined) samples.push(propertyKeyframe(key, property));
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
        const samples = keys.flatMap((key) => (key[property] === undefined ? [] : [propertyKeyframe(key, property)]));
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
    ...(clip.rootMotion ? { rootMotion: clip.rootMotion } : {}),
    ...(clip.deformationTracks ? { deformationTracks: clip.deformationTracks } : {}),
    ...(clip.ikTracks ? { ikTracks } : {}),
    ...(clip.disabledIKConstraints ? { disabledIKConstraints: clip.disabledIKConstraints } : {}),
    events,
    ...(clip.playback ? { playback: { ...clip.playback } } : {}),
  });
}

export function sampleProperty(keys: readonly PropertyKeyframe[], time: number, property?: TransformProperty): number {
  assertFinite(time, 'Property sample time');
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
  const duration = next.time - previous.time;
  // Compilation rejects duplicates; retain a safe fallback for direct low-level callers.
  if (duration <= 0) return next.value;
  const progress = evaluateCurveProgress(previous.curve, (time - previous.time) / duration);
  if (property === 'rotation') {
    return previous.value + shortestRotationDelta(previous.value, next.value) * progress;
  }
  return interpolateNumber(previous.value, next.value, progress);
}
