import type { CompiledClip } from './AnimationClip.js';
import { sampleProperty } from './AnimationClip.js';
import type { JointTransform, TransformProperty } from './types.js';
import { transformProperties } from './types.js';

export type AnimationPose = Map<string, Partial<JointTransform>>;

export function lerpProperty(property: TransformProperty, from: number, to: number, weight: number): number {
  if (weight <= 0) return from;
  if (weight >= 1) return to;
  if (property !== 'rotation') return from + (to - from) * weight;
  const difference = ((((to - from + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return from + difference * weight;
}

export function evaluateClip(clip: CompiledClip, time: number): AnimationPose {
  const pose: AnimationPose = new Map();
  for (const track of clip.tracks) {
    const values: Partial<JointTransform> = {};
    for (const [property, keys] of track.properties) values[property] = sampleProperty(keys, time, property);
    if (track.properties.size) pose.set(track.bone, values);
  }
  return pose;
}

/** Fill absent properties from the underlying pose. Layer masks are checked by the caller. */
export function blendPose(
  underlying: AnimationPose,
  source: AnimationPose,
  target: AnimationPose,
  weight: number,
  mask?: ReadonlySet<string>,
): AnimationPose {
  const result: AnimationPose = new Map();
  for (const [bone, values] of underlying) result.set(bone, { ...values });
  const ids = new Set([...source.keys(), ...target.keys()]);
  for (const id of ids) {
    if (mask && !mask.has(id)) continue;
    const base = result.get(id) ?? {};
    const from = source.get(id) ?? {};
    const to = target.get(id) ?? {};
    for (const property of transformProperties) {
      const fallback = base[property];
      const a = from[property] ?? fallback;
      const b = to[property] ?? fallback;
      if (a !== undefined && b !== undefined) base[property] = lerpProperty(property, a, b, weight);
    }
    result.set(id, base);
  }
  return result;
}
