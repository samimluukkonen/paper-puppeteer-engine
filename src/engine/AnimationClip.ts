import type { Rig } from './Rig.js';
import { animationClipSchema } from './schemas.js';
import type { JointTransform, TransformProperty } from './types.js';
import { transformProperties } from './types.js';
import { checkAnimationReferences, throwValidationIssue } from './validation.js';

export type Interpolation = 'linear';

export interface Keyframe extends Partial<JointTransform> {
  /** Milliseconds from the start of the clip. Values are absolute local poses. */
  time: number;
}

export interface AnimationClip {
  name: string;
  duration: number;
  loop: boolean;
  interpolation?: Interpolation;
  tracks: Readonly<Record<string, readonly Keyframe[]>>;
  events?: readonly AnimationEvent[];
  playback?: AnimationPlaybackMode;
}

export interface AnimationEvent {
  time: number;
  name: string;
  data?: unknown;
}

export type AnimationPlaybackMode = { mode: 'smooth' } | { mode: 'stepped'; fps: number };

export interface PropertyKeyframe {
  readonly time: number;
  readonly value: number;
}

export interface CompiledTrack {
  readonly bone: string;
  readonly properties: ReadonlyMap<TransformProperty, readonly PropertyKeyframe[]>;
}

export interface CompiledClip {
  readonly name: string;
  readonly duration: number;
  readonly loop: boolean;
  readonly tracks: readonly CompiledTrack[];
  readonly events: readonly AnimationEvent[];
  readonly playback?: AnimationPlaybackMode;
}

/** Compile sparse keys per property once rather than searching them every frame. */
export function compileClip(clip: AnimationClip, rig: Rig): CompiledClip {
  clip = animationClipSchema.parse(clip);
  checkAnimationReferences(clip, rig, throwValidationIssue);
  const events = (clip.events ?? []).map((event) => ({ ...event })).sort((a, b) => a.time - b.time);
  const tracks: CompiledTrack[] = [];
  for (const [bone, keys] of Object.entries(clip.tracks)) {
    const properties = new Map<TransformProperty, readonly PropertyKeyframe[]>();
    for (const property of transformProperties) {
      const samples: PropertyKeyframe[] = [];
      for (const key of keys) {
        const value = key[property];
        if (value !== undefined) samples.push({ time: key.time, value });
      }
      if (samples.length > 0) properties.set(property, samples);
    }
    tracks.push({ bone, properties });
  }
  return {
    name: clip.name,
    duration: clip.duration,
    loop: clip.loop,
    tracks,
    events,
    ...(clip.playback ? { playback: { ...clip.playback } } : {}),
  };
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
    const difference =
      ((((next.value - previous.value + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    return previous.value + difference * progress;
  }
  return previous.value + (next.value - previous.value) * progress;
}
