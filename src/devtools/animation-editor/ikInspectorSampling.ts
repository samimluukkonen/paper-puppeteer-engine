import { quantizePlaybackTime, IsolatedIKSampler, isFullyFrozen, type IKTargetValues } from '../../engine/core.js';
import type { Rig } from '../../engine/data.js';
import type { AnimationData } from './keyframeTargets.js';
import { getCompiledPreviewClip } from './previewClip.js';

/** Retain only the last immutable inspector sample; evaluation belongs to the shared isolated solver. */
class IKInspectorSampler {
  private readonly sampler: IsolatedIKSampler;
  private animation: AnimationData | undefined;
  private time: number | undefined;
  private values: ReadonlyMap<string, IKTargetValues> = new Map();

  constructor(private readonly rig: Rig) {
    this.sampler = new IsolatedIKSampler(rig);
  }

  sample(animation: AnimationData, timeMs: number): ReadonlyMap<string, IKTargetValues> {
    const clip = getCompiledPreviewClip(animation, this.rig);
    if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > clip.duration)
      throw new Error('Sample time must stay within the animation duration.');
    const time = timeMs === clip.duration ? timeMs : quantizePlaybackTime(timeMs, clip.playback ?? { mode: 'smooth' });
    if (isFullyFrozen(animation) && this.animation === animation && this.time === time) return this.values;
    this.values = this.sampler.sample(clip, timeMs).targets;
    this.animation = animation;
    this.time = time;
    return this.values;
  }
}
const inspectorSamplers = new WeakMap<Rig, IKInspectorSampler>();

/** Shared runtime sampling, including endpoint offsets and preceding rig constraints. */
export function evaluateIKTarget(
  animation: AnimationData,
  rig: Rig,
  id: string,
  timeMs: number,
): IKTargetValues | undefined {
  if (!rig.ik?.some((constraint) => constraint.name === id)) return undefined;
  let sampler = inspectorSamplers.get(rig);
  if (!sampler) {
    sampler = new IKInspectorSampler(rig);
    inspectorSamplers.set(rig, sampler);
  }
  return sampler.sample(animation, timeMs).get(id);
}
