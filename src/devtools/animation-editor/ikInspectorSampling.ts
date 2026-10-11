import { composeAffine, localToWorld, worldToLocal, transformToAffine, type Affine } from '../../engine/affineMath.js';
import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { evaluateIKClip } from '../../engine/ik/AnimationIKPose.js';
import type { IKAnimationProperty } from '../../engine/ik/animationKeyframes.js';
import { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../../engine/Joint.js';
import { isFullyFrozen } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { getEvaluatedAnimationPose } from './animationValues.js';
import type { AnimationData } from './keyframeTargets.js';
import { getCompiledPreviewClip } from './previewClip.js';

type IKTargetValues = Readonly<Record<IKAnimationProperty, number>>;

/** Renderer-independent inspector sampler. Reuse the existing solver for priority-ordered sparse
 * fallbacks without touching the live puppet, rebuilding its rig, or owning another clock.
 */
class IKInspectorSampler {
  private readonly joints: Map<string, Joint>;
  private readonly constraints: TwoBoneIKConstraint[];
  private animation: AnimationData | undefined;
  private time: number | undefined;
  private values = new Map<string, IKTargetValues>();

  constructor(private readonly rig: Rig) {
    this.joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
    this.constraints = (rig.ik ?? [])
      .map((definition) => new TwoBoneIKConstraint(definition, rig, this.joints))
      .sort((a, b) => a.priority - b.priority);
  }
  sample(animation: AnimationData, timeMs: number): ReadonlyMap<string, IKTargetValues> {
    const clip = getCompiledPreviewClip(animation, this.rig);
    const time =
      timeMs === animation.duration ? timeMs : quantizePlaybackTime(timeMs, clip.playback ?? { mode: 'smooth' });
    if (isFullyFrozen(animation) && this.animation === animation && this.time === time) return this.values;
    const pose = getEvaluatedAnimationPose(animation, this.rig, timeMs);
    for (const [id, joint] of this.joints) Object.assign(joint.pose, pose.get(id));
    const channels = evaluateIKClip(clip, time);
    const matrices = new Map<string, Affine>();
    const matrixFor = (id: string): Affine => {
      const cached = matrices.get(id);
      if (cached) return cached;
      const ancestors: string[] = [];
      let current: string | undefined = id;
      while (current !== undefined && !matrices.has(current)) {
        ancestors.push(current);
        current = this.rig.getBone(current).parent;
      }
      let parent = current === undefined ? undefined : matrices.get(current);
      for (let index = ancestors.length - 1; index >= 0; --index) {
        const boneId = ancestors[index]!;
        const local = transformToAffine(this.joints.get(boneId)!.pose, {} as Affine);
        parent = composeAffine(local, parent, {} as Affine);
        matrices.set(boneId, parent);
      }
      return matrices.get(id)!;
    };
    const context = {
      puppetToWorld: (point: { x: number; y: number }) => point,
      worldToPuppet: (point: { x: number; y: number }) => point,
      endToWorld: (id: string, offset: { x: number; y: number }) => localToWorld(offset, matrixFor(id)),
      worldToParent: (id: string, point: { x: number; y: number }) => {
        const parent = this.rig.getBone(id).parent;
        return parent ? worldToLocal(point, matrixFor(parent)) : point;
      },
    };
    const values = new Map<string, IKTargetValues>();
    for (const constraint of this.constraints) {
      const fallback = context.endToWorld(constraint.endBone, constraint.endOffset);
      const authored = channels.get(constraint.name);
      values.set(
        constraint.name,
        Object.freeze({
          x: authored?.x?.value ?? fallback.x,
          y: authored?.y?.value ?? fallback.y,
          mix: authored?.mix?.value ?? constraint.mix,
        }),
      );
      constraint.apply(context, authored);
      matrices.clear();
    }
    this.animation = animation;
    this.time = time;
    this.values = values;
    return values;
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
