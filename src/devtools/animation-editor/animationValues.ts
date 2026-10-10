import type { CompiledClip } from '../../engine/AnimationClip.js';
import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { type AnimationPose, ClipPoseBuffer } from '../../engine/AnimationPose.js';
import type { Rig } from '../../engine/Rig.js';
import { assertFinite, createTransform, type JointTransform, type TransformProperty } from '../../engine/types.js';
import { isFullyFrozen } from '../shared/editorData.js';
import { type AnimationData, assertTarget } from './keyframeTargets.js';
import { getCompiledPreviewClip } from './previewClip.js';
import { type Milliseconds } from './timeUnits.js';

/** Reuses the runtime pose buffer and playback quantization without clocks, events, or IK. */
class AnimationValueSampler {
  private readonly clip: CompiledClip;
  private readonly buffer = new ClipPoseBuffer();
  // Six neighbors plus the inspector/current pose fit without reevaluating held stepped frames.
  // Snapshot/rig ownership is weak; each sampler retains at most eight detached sparse poses.
  private readonly poses = new Map<number, AnimationPose>();

  constructor(
    animation: AnimationData,
    private readonly rig: Rig,
  ) {
    this.clip = getCompiledPreviewClip(animation, rig);
  }

  private evaluate(timeMs: Milliseconds): AnimationPose {
    const time =
      timeMs === this.clip.duration ? timeMs : quantizePlaybackTime(timeMs, this.clip.playback ?? { mode: 'smooth' });
    const cached = this.poses.get(time);
    if (cached) {
      this.poses.delete(time);
      this.poses.set(time, cached);
      return cached;
    }
    // The runtime buffer mutates on its next evaluation, so cache an owned sparse snapshot.
    const pose = new Map([...this.buffer.evaluate(this.clip, time)].map(([id, values]) => [id, { ...values }]));
    this.poses.set(time, pose);
    if (this.poses.size > 8) this.poses.delete(this.poses.keys().next().value!);
    return pose;
  }

  sample(boneId: string, timeMs: Milliseconds): JointTransform {
    return { ...createTransform(this.rig.getBone(boneId)), ...this.evaluate(timeMs).get(boneId) };
  }

  samplePose(timeMs: Milliseconds): AnimationPose {
    const sparse = this.evaluate(timeMs);
    return new Map(this.rig.bones.map((bone) => [bone.id, { ...createTransform(bone), ...sparse.get(bone.id) }]));
  }
}

/** Detached complete bone-local pose before drafts, presets, IK and render projection.
 * Hierarchy/appearance remain in the rig; no Puppet or player state is read or written.
 */
export function getEvaluatedAnimationPose(animation: AnimationData, rig: Rig, timeMs: Milliseconds): AnimationPose {
  assertFinite(timeMs, 'Sample time');
  if (timeMs < 0 || timeMs > animation.duration)
    throw new Error('Sample time must stay within the animation duration.');
  return valueSampler(animation, rig).samplePose(timeMs);
}

const valueSamplers = new WeakMap<AnimationData, WeakMap<Rig, AnimationValueSampler>>();

function valueSampler(animation: AnimationData, rig: Rig): AnimationValueSampler {
  const cached = valueSamplers.get(animation)?.get(rig);
  if (cached) return cached;
  // Validate before inspecting nested data for cache eligibility. Mutable inputs remain fresh on every call.
  const sampler = new AnimationValueSampler(animation, rig);
  if (isFullyFrozen(animation)) {
    let rigs = valueSamplers.get(animation);
    if (!rigs) {
      rigs = new WeakMap();
      valueSamplers.set(animation, rigs);
    }
    rigs.set(rig, sampler);
  }
  return sampler;
}

/** Sample all absolute local properties together; returned values cannot mutate the cached pose. */
export function getEvaluatedBoneTransform(
  animation: AnimationData,
  rig: Rig,
  boneId: string,
  timeMs: Milliseconds,
): JointTransform {
  timeMs = assertTarget(animation, rig, boneId, undefined, timeMs);
  return valueSampler(animation, rig).sample(boneId, timeMs);
}

/** Unkeyed properties use the rig bind pose. Fully frozen snapshots share compilation and evaluation. */
export function getEvaluatedBonePropertyValue(
  animation: AnimationData,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  timeMs: Milliseconds,
): number {
  timeMs = assertTarget(animation, rig, boneId, property, timeMs);
  return valueSampler(animation, rig).sample(boneId, timeMs)[property];
}
