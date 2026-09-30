import type { Rig } from './Rig.js';
import type { JointTransform, TransformProperty } from './types.js';
import { assertFinite, transformProperties } from './types.js';

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
  if (!clip.name) throw new Error('An animation needs a name.');
  assertFinite(clip.duration, `${clip.name}.duration`);
  if (clip.duration <= 0) throw new Error('Animation duration must be greater than zero.');
  if (clip.interpolation !== undefined && clip.interpolation !== 'linear') {
    throw new Error(`Unsupported interpolation: ${String(clip.interpolation)}.`);
  }
  if (clip.playback?.mode === 'stepped') {
    assertFinite(clip.playback.fps, `${clip.name}.playback.fps`);
    if (clip.playback.fps <= 0) throw new Error('Animation FPS must be greater than zero.');
  }
  const events = (clip.events ?? [])
    .map((event) => {
      assertFinite(event.time, `${clip.name}.event.time`);
      if (event.time < 0 || event.time > clip.duration || !event.name) {
        throw new Error(`Invalid event in animation "${clip.name}".`);
      }
      return { ...event };
    })
    .sort((a, b) => a.time - b.time);
  const tracks: CompiledTrack[] = [];
  for (const [bone, keys] of Object.entries(clip.tracks)) {
    rig.getBone(bone);
    const properties = new Map<TransformProperty, readonly PropertyKeyframe[]>();
    let previousTime = -1;
    for (const key of keys) {
      assertFinite(key.time, `${clip.name}.${bone}.time`);
      if (key.time < 0 || key.time > clip.duration || key.time <= previousTime) {
        throw new Error(`Keys for "${bone}" must have strictly increasing times within the clip.`);
      }
      previousTime = key.time;
      for (const property of transformProperties) {
        const value = key[property];
        if (value !== undefined) assertFinite(value, `${clip.name}.${bone}.${property}`);
      }
    }
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
  for (let index = 1; index < keys.length; index += 1) {
    const next = keys[index];
    const previous = keys[index - 1];
    if (next && previous && time <= next.time) {
      const progress = (time - previous.time) / (next.time - previous.time);
      if (property === 'rotation') {
        const difference =
          ((((next.value - previous.value + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
        return previous.value + difference * progress;
      }
      return previous.value + (next.value - previous.value) * progress;
    }
  }
  return keys[keys.length - 1]?.value ?? first.value;
}
