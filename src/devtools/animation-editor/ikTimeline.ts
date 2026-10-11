import { composeAffine, localToWorld, worldToLocal, transformToAffine, type Affine } from '../../engine/affineMath.js';
import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { evaluateIKClip } from '../../engine/ik/AnimationIKPose.js';
import { ikAnimationProperties, type IKAnimationProperty } from '../../engine/ik/animationKeyframes.js';
import { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../../engine/Joint.js';
import { isFullyFrozen } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { getEvaluatedAnimationPose } from './animationValues.js';
import type { AnimationData } from './keyframeTargets.js';
import { getCompiledPreviewClip } from './previewClip.js';
import { toSeconds, type Seconds } from './timeUnits.js';

export interface IKKeyframeSelection {
  readonly kind: 'ik';
  readonly constraintId: string;
  readonly property: IKAnimationProperty;
  readonly time: Seconds;
}
export interface IKTimelineTrack {
  readonly kind: 'ik';
  readonly constraintId: string;
  readonly depth: number;
  readonly expanded: boolean;
  readonly hasKeys: boolean;
}
export interface IKPropertyTimelineTrack {
  readonly kind: 'ik-property';
  readonly constraintId: string;
  readonly property: IKAnimationProperty;
  readonly depth: number;
  readonly hasKeys: boolean;
  readonly keyframes: readonly (IKKeyframeSelection & { readonly value: number })[];
}
export type IKTimelineRow = IKTimelineTrack | IKPropertyTimelineTrack;
export const ikTrackKey = (id: string, property: IKAnimationProperty | null = null): string =>
  JSON.stringify(['ik', id, property]);

/** Real rig constraints, including empty channels. No bone identities are synthesized. */
export function buildIKTimelineTracks(
  rig: Rig | undefined,
  animation: AnimationData | null,
  expanded: ReadonlySet<string>,
  previous: readonly IKTimelineRow[] = [],
): readonly IKTimelineRow[] {
  const before = new Map(
    previous.map((row) => [ikTrackKey(row.constraintId, row.kind === 'ik' ? null : row.property), row]),
  );
  return Object.freeze(
    (rig?.ik ?? []).flatMap((constraint): IKTimelineRow[] => {
      const id = constraint.name;
      const keys = animation?.ikTracks && Object.hasOwn(animation.ikTracks, id) ? animation.ikTracks[id]! : [];
      const open = expanded.has(id);
      const hasKeys = keys.length > 0;
      const parent = before.get(ikTrackKey(id));
      const rows: IKTimelineRow[] = [
        parent?.kind === 'ik' && parent.expanded === open && parent.hasKeys === hasKeys
          ? parent
          : Object.freeze({ kind: 'ik', constraintId: id, depth: 0, expanded: open, hasKeys }),
      ];
      if (open)
        for (const property of ikAnimationProperties) {
          const keyframes = keys.flatMap((key) =>
            key[property] === undefined
              ? []
              : [
                  Object.freeze({
                    kind: 'ik' as const,
                    constraintId: id,
                    property,
                    time: toSeconds(key.time),
                    value: key[property],
                  }),
                ],
          );
          const old = before.get(ikTrackKey(id, property));
          rows.push(
            old?.kind === 'ik-property' &&
              old.keyframes.length === keyframes.length &&
              old.keyframes.every(
                (key, index) => key.time === keyframes[index]!.time && key.value === keyframes[index]!.value,
              )
              ? old
              : Object.freeze({
                  kind: 'ik-property',
                  constraintId: id,
                  property,
                  depth: 1,
                  hasKeys: keyframes.length > 0,
                  keyframes: Object.freeze(keyframes),
                }),
          );
        }
      return rows;
    }),
  );
}

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
