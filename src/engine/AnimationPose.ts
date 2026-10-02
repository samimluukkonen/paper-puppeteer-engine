import type { CompiledClip } from './AnimationClip.js';
import { sampleProperty } from './AnimationClip.js';
import { shortestRotationDelta } from './animationMath.js';
import type { JointTransform, TransformProperty } from './types.js';
import { assertFinite, transformProperties } from './types.js';

export type AnimationPose = Map<string, Partial<JointTransform>>;

export function lerpProperty(property: TransformProperty, from: number, to: number, weight: number): number {
  if (weight <= 0) return from;
  if (weight >= 1) return to;
  if (property !== 'rotation') return from + (to - from) * weight;
  return from + shortestRotationDelta(from, to) * weight;
}

export function evaluateClip(clip: CompiledClip, time: number): AnimationPose {
  assertFinite(time, 'Sample time');
  const pose: AnimationPose = new Map();
  for (const track of clip.tracks) {
    const values: Partial<JointTransform> = {};
    for (const [property, keys] of track.properties) values[property] = sampleProperty(keys, time, property);
    if (track.properties.size) pose.set(track.bone, values);
  }
  return pose;
}

/** A private evaluation buffer; changing clips rebuilds its sparse property layout. */
export class ClipPoseBuffer {
  private clip: CompiledClip | undefined;
  private pose: AnimationPose = new Map();

  evaluate(clip: CompiledClip, time: number): AnimationPose {
    assertFinite(time, 'Sample time');
    if (this.clip !== clip) {
      this.clip = clip;
      this.pose = evaluateClip(clip, time);
    } else {
      for (const track of clip.tracks) {
        const values = this.pose.get(track.bone);
        if (!values) continue;
        for (const [property, keys] of track.properties) values[property] = sampleProperty(keys, time, property);
      }
    }
    return this.pose;
  }
}

/** Blend into an owned working pose, preserving values outside the sparse inputs. */
export function blendPoseInto(
  result: AnimationPose,
  source: AnimationPose,
  target: AnimationPose,
  weight: number,
  mask?: ReadonlySet<string>,
): void {
  const blend = (id: string): void => {
    if (mask && !mask.has(id)) return;
    const base = result.get(id) ?? {};
    const from = source.get(id);
    const to = target.get(id);
    for (const property of transformProperties) {
      const fallback = base[property];
      const a = from?.[property] ?? fallback;
      const b = to?.[property] ?? fallback;
      if (a !== undefined && b !== undefined) base[property] = lerpProperty(property, a, b, weight);
    }
    result.set(id, base);
  };
  for (const id of source.keys()) blend(id);
  for (const id of target.keys()) if (!source.has(id)) blend(id);
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
  blendPoseInto(result, source, target, weight, mask);
  return result;
}
