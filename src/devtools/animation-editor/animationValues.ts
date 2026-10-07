import type { CompiledClip } from '../../engine/AnimationClip.js';
import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { ClipPoseBuffer } from '../../engine/AnimationPose.js';
import type { Rig } from '../../engine/Rig.js';
import { createTransform, type JointTransform, type TransformProperty } from '../../engine/types.js';
import { isFullyFrozen } from '../shared/editorData.js';
import { type AnimationData, assertTarget } from './keyframeTargets.js';
import { getCompiledPreviewClip } from './previewClip.js';

/** Reuses the runtime pose buffer and playback quantization without clocks, events, or IK. */
class AnimationValueSampler {
  private readonly clip: CompiledClip;
  private readonly buffer = new ClipPoseBuffer();
  private sampledTime: number | undefined;
  private pose: ReturnType<ClipPoseBuffer['evaluate']> | undefined;

  constructor(
    animation: AnimationData,
    private readonly rig: Rig,
  ) {
    this.clip = getCompiledPreviewClip(animation, rig);
  }

  sample(boneId: string, timeMs: number): JointTransform {
    const time =
      timeMs === this.clip.duration ? timeMs : quantizePlaybackTime(timeMs, this.clip.playback ?? { mode: 'smooth' });
    // Repeated property queries at the same playback frame share one pose evaluation.
    if (time !== this.sampledTime) {
      this.pose = this.buffer.evaluate(this.clip, time);
      this.sampledTime = time;
    }
    return { ...createTransform(this.rig.getBone(boneId)), ...this.pose?.get(boneId) };
  }
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
  timeMs: number,
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
  timeMs: number,
): number {
  timeMs = assertTarget(animation, rig, boneId, property, timeMs);
  return valueSampler(animation, rig).sample(boneId, timeMs)[property];
}
