import { type Affine, composeAffine, localToWorld, transformToAffine, worldToLocal } from '../affineMath.js';
import type { CompiledClip } from '../AnimationClip.js';
import { quantizePlaybackTime } from '../animationMath.js';
import { ClipPoseBuffer } from '../AnimationPose.js';
import { Joint } from '../Joint.js';
import { readonlyMap } from '../readonlyData.js';
import type { Rig } from '../Rig.js';
import type { JointTransform } from '../types.js';
import { evaluateIKClip } from './AnimationIKPose.js';
import type { IKAnimationProperty } from './animationKeyframes.js';
import { TwoBoneIKConstraint } from './TwoBoneIKConstraint.js';
import type { IKStatus, IKTarget, IKTransformContext } from './types.js';

export type IKTargetValues = Readonly<Record<IKAnimationProperty, number>>;

/** @internal Shared inspector/bake evaluation. Owns detached joints and the existing solver,
 * with identity puppet placement and no player, clock, events, renderer or editor state.
 */
export class IsolatedIKSampler {
  private readonly joints: Map<string, Joint>;
  private readonly constraints: TwoBoneIKConstraint[];
  private readonly buffer = new ClipPoseBuffer();
  private readonly matrices = new Map<string, Affine>();
  private readonly context: IKTransformContext;

  constructor(private readonly rig: Rig) {
    this.joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
    this.constraints = (rig.ik ?? [])
      .map((definition) => new TwoBoneIKConstraint(definition, rig, this.joints))
      .sort((a, b) => a.priority - b.priority);
    this.context = {
      puppetToWorld: (point) => point,
      worldToPuppet: (point) => point,
      endToWorld: (id, offset) => localToWorld(offset, this.matrixFor(id)),
      worldToParent: (id, point) => {
        const parent = this.rig.getBone(id).parent;
        return parent === undefined ? point : worldToLocal(point, this.matrixFor(parent));
      },
    };
  }

  private matrixFor(id: string): Affine {
    const cached = this.matrices.get(id);
    if (cached) return cached;
    const ancestors: string[] = [];
    let current: string | undefined = id;
    while (current !== undefined && !this.matrices.has(current)) {
      ancestors.push(current);
      current = this.rig.getBone(current).parent;
    }
    let parent = current === undefined ? undefined : this.matrices.get(current);
    for (let index = ancestors.length - 1; index >= 0; --index) {
      const boneId = ancestors[index]!;
      const local = transformToAffine(this.joints.get(boneId)!.pose, {} as Affine);
      parent = composeAffine(local, parent, {} as Affine);
      this.matrices.set(boneId, parent);
    }
    return this.matrices.get(id)!;
  }

  sample(
    clip: CompiledClip,
    timeMs: number,
  ): {
    time: number;
    pose: ReadonlyMap<string, Readonly<JointTransform>>;
    targets: ReadonlyMap<string, IKTargetValues>;
    constraints: ReadonlyMap<string, { readonly status: IKStatus; readonly target?: Readonly<IKTarget> }>;
  } {
    const time = timeMs === clip.duration ? timeMs : quantizePlaybackTime(timeMs, clip.playback ?? { mode: 'smooth' });
    const pose = this.buffer.evaluate(clip, time);
    for (const [id, joint] of this.joints) {
      joint.reset();
      Object.assign(joint.pose, pose.get(id));
    }
    this.matrices.clear();
    const channels = evaluateIKClip(clip, time);
    const targets = new Map<string, IKTargetValues>();
    for (const constraint of this.constraints) {
      const fallback = this.context.endToWorld!(constraint.endBone, constraint.endOffset);
      const authored = channels.get(constraint.name);
      targets.set(
        constraint.name,
        Object.freeze({
          x: authored?.x?.value ?? fallback.x,
          y: authored?.y?.value ?? fallback.y,
          mix: authored?.mix?.value ?? constraint.mix,
        }),
      );
      constraint.apply(this.context, authored);
      // Sparse fallback targets on later chains must see all preceding solved transforms.
      this.matrices.clear();
    }
    return {
      time,
      pose: readonlyMap([...this.joints].map(([id, joint]) => [id, Object.freeze({ ...joint.pose })])),
      targets: readonlyMap(targets),
      constraints: readonlyMap(
        this.constraints.map((constraint) => [
          constraint.name,
          Object.freeze({
            status: constraint.status,
            ...(constraint.resolvedTarget ? { target: Object.freeze({ ...constraint.resolvedTarget }) } : {}),
          }),
        ]),
      ),
    };
  }
}
