import { ikAnimationProperties, type IKAnimationProperty } from '../../engine/ik/animationKeyframes.js';
import type { Rig } from '../../engine/Rig.js';
import type { AnimationData } from './keyframeTargets.js';
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
