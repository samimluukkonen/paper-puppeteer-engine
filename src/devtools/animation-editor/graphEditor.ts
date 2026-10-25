import { sampleProperty, type PropertyKeyframe } from '../../engine/AnimationClip.js';
import {
  copyPropertyCurve,
  propertyKeyframe,
  withoutKeyframeProperty,
  type CurveHandle,
  type PropertyCurve,
} from '../../engine/animationCurves.js';
import { quantizePlaybackTime, shortestRotationDelta } from '../../engine/animationMath.js';
import { ikAnimationProperties, type IKAnimationProperty } from '../../engine/ik/animationKeyframes.js';
import type { Rig } from '../../engine/Rig.js';
import { transformProperties, type TransformProperty } from '../../engine/types.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { rootKeys } from './rootMotionEdits.js';
import { toMilliseconds, toSeconds } from './timeUnits.js';
import { validateEditedAnimation } from './validatedAnimation.js';

export type GraphChannel =
  | { readonly kind: 'root'; readonly id: 'Root Motion'; readonly property: 'x' | 'y' }
  | { readonly kind: 'bone'; readonly id: string; readonly property: TransformProperty }
  | { readonly kind: 'ik'; readonly id: string; readonly property: IKAnimationProperty };
export interface GraphKeyRef {
  readonly channel: GraphChannel;
  readonly time: number;
}
export interface GraphKeyEdit {
  readonly time?: number;
  readonly value?: number;
  readonly curve?: PropertyCurve | null;
}
export interface GraphViewport {
  readonly start: number;
  readonly end: number;
  readonly min: number;
  readonly max: number;
}
export const DEFAULT_GRAPH_CURVE: Extract<PropertyCurve, { mode: 'bezier' }> = {
  mode: 'bezier',
  control1: { x: 1 / 3, y: 0 },
  control2: { x: 2 / 3, y: 1 },
};
export const graphPropertyLabels: Record<TransformProperty | IKAnimationProperty, string> = {
  x: 'Translation X',
  y: 'Translation Y',
  rotation: 'Rotation (°)',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  mix: 'IK influence',
};
export function graphChannels(state: AnimationEditorState): readonly GraphChannel[] {
  if (state.rootMotionSelected)
    return (['x', 'y'] as const).map((property) => ({ kind: 'root', id: 'Root Motion', property }));
  if (state.selectedIKConstraintId)
    return ikAnimationProperties.map((property) => ({ kind: 'ik', id: state.selectedIKConstraintId!, property }));
  if (state.selectedBoneId)
    return transformProperties.map((property) => ({ kind: 'bone', id: state.selectedBoneId!, property }));
  return [];
}
export function selectedGraphChannel(state: AnimationEditorState): GraphChannel | undefined {
  const channels = graphChannels(state);
  return (
    channels.find(
      (channel) =>
        channel.property ===
        (channel.kind === 'root'
          ? state.rootMotionProperty
          : channel.kind === 'ik'
            ? state.selectedIKProperty
            : state.selectedTimelineProperty),
    ) ?? channels[0]
  );
}
export function graphKeys(animation: ReadonlyAnimation, channel: GraphChannel): readonly PropertyKeyframe[] {
  if (channel.kind === 'root') return rootKeys(animation, channel.property);
  if (channel.kind === 'bone')
    return (Object.hasOwn(animation.tracks, channel.id) ? animation.tracks[channel.id]! : []).flatMap((key) =>
      key[channel.property] === undefined ? [] : [propertyKeyframe(key, channel.property)],
    );
  return (
    animation.ikTracks && Object.hasOwn(animation.ikTracks, channel.id) ? animation.ikTracks[channel.id]! : []
  ).flatMap((key) => (key[channel.property] === undefined ? [] : [propertyKeyframe(key, channel.property)]));
}
export const isGraphRotation = (channel: GraphChannel): boolean =>
  channel.kind === 'bone' && channel.property === 'rotation';
export const graphDisplayValue = (channel: GraphChannel, value: number): number =>
  isGraphRotation(channel) ? (value * 180) / Math.PI : value;
export const graphLocalValue = (channel: GraphChannel, value: number): number =>
  isGraphRotation(channel) ? (value * Math.PI) / 180 : value;
/** Unwrap for display only. Authored multi-turn radians remain untouched. */
export function graphDisplayKeys(animation: ReadonlyAnimation, channel: GraphChannel): readonly PropertyKeyframe[] {
  let previous = 0;
  return graphKeys(animation, channel).map((key, index) => {
    const value = isGraphRotation(channel) && index ? previous + shortestRotationDelta(previous, key.value) : key.value;
    previous = value;
    return { ...key, value: graphDisplayValue(channel, value) };
  });
}
/** Runtime sampler and frame quantization; unwrapped rotations are equivalent modulo a full turn. */
export function sampleGraph(animation: ReadonlyAnimation, keys: readonly PropertyKeyframe[], time: number): number {
  const milliseconds = toMilliseconds(time);
  const sampled =
    milliseconds === animation.duration
      ? milliseconds
      : quantizePlaybackTime(milliseconds, animation.playback ?? { mode: 'smooth' });
  return sampleProperty(keys, sampled);
}
/** Atomic, channel-scoped edit. Moving across or onto a neighbor is rejected, never merged. */
export function editGraphKey(
  animation: ReadonlyAnimation,
  rig: Rig,
  ref: GraphKeyRef,
  edit: GraphKeyEdit,
): ReadonlyAnimation {
  const channel = ref.channel;
  const keys = graphKeys(animation, channel);
  const index = keys.findIndex((key) => toSeconds(key.time) === ref.time);
  const key = keys[index];
  if (!key) throw new Error('The graph key is no longer available.');
  const time = edit.time === undefined ? key.time : toMilliseconds(edit.time);
  const value = edit.value ?? key.value;
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(value) ||
    time < 0 ||
    time > animation.duration ||
    (index > 0 && time <= keys[index - 1]!.time) ||
    (index + 1 < keys.length && time >= keys[index + 1]!.time)
  )
    throw new Error('Key time must stay inside the clip and between its neighboring keys.');
  if (channel.kind === 'ik' && channel.property === 'mix' && (value < 0 || value > 1))
    throw new Error('IK influence must be between 0 and 1.');
  const inputCurve = edit.curve === undefined ? key.curve : (edit.curve ?? undefined);
  const curve = inputCurve ? copyPropertyCurve(inputCurve) : undefined;
  // A terminal key can retain existing metadata, but cannot gain a new outgoing segment.
  if (edit.curve !== undefined && index === keys.length - 1)
    throw new Error('Select a key with a following key to edit interpolation.');
  const update = <
    P extends string,
    K extends { readonly time: number; readonly curves?: Partial<Record<P, PropertyCurve>> } & Partial<
      Record<P, number>
    >,
  >(
    rows: readonly K[],
    property: P,
  ): K[] => {
    const result = rows.flatMap((row) => {
      if (row.time !== key.time) return [row];
      const remainder = withoutKeyframeProperty(row, property);
      return Object.keys(remainder).some((name) => name !== 'time' && name !== 'curves') ? [remainder] : [];
    });
    const destination = result.findIndex((row) => row.time === time);
    const row = destination < 0 ? { time } : result[destination]!;
    const next = {
      ...row,
      [property]: value,
      ...(curve ? { curves: { ...('curves' in row ? row.curves : {}), [property]: curve } } : {}),
    } as K;
    if (destination < 0) result.push(next);
    else result[destination] = next;
    return result.sort((a, b) => a.time - b.time);
  };
  const next =
    channel.kind === 'root'
      ? {
          ...animation,
          rootMotion: { translationKeys: update(animation.rootMotion!.translationKeys, channel.property) },
        }
      : channel.kind === 'bone'
        ? {
            ...animation,
            tracks: { ...animation.tracks, [channel.id]: update(animation.tracks[channel.id]!, channel.property) },
          }
        : {
            ...animation,
            ikTracks: {
              ...animation.ikTracks,
              [channel.id]: update(animation.ikTracks![channel.id]!, channel.property),
            },
          };
  return validateEditedAnimation(next, animation, rig);
}
/** Normalize tangent input before validating a preview. Time controls cannot cross. */
export function constrainGraphHandle(
  curve: Extract<PropertyCurve, { mode: 'bezier' }>,
  handle: 'control1' | 'control2',
  point: CurveHandle,
): PropertyCurve {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Tangent coordinates must be finite.');
  return {
    ...curve,
    [handle]: {
      x: clamp(point.x, handle === 'control2' ? curve.control1.x : 0, handle === 'control1' ? curve.control2.x : 1),
      y: clamp(point.y, 0, 1),
    },
  };
}
export function fitGraph(animation: ReadonlyAnimation, channel: GraphChannel): GraphViewport {
  const keys = graphDisplayKeys(animation, channel);
  let min = keys[0]?.value ?? 0;
  let max = min;
  for (const key of keys) {
    min = Math.min(min, key.value);
    max = Math.max(max, key.value);
  }
  const margin = max > min ? (max - min) * 0.15 : Math.max(Math.abs(min) * 0.15, 0.001);
  return { start: 0, end: toSeconds(animation.duration), min: min - margin, max: max + margin };
}
/** Graph coordinates are CSS pixels within the plot; values increase upwards, seconds rightwards. */
export const graphToPoint = (time: number, value: number, view: GraphViewport, width: number, height: number) => ({
  x: ((time - view.start) / (view.end - view.start)) * width,
  y: ((view.max - value) / (view.max - view.min)) * height,
});
export const pointToGraph = (x: number, y: number, view: GraphViewport, width: number, height: number) => ({
  time: view.start + (x / width) * (view.end - view.start),
  value: view.max - (y / height) * (view.max - view.min),
});
export function zoomGraph(view: GraphViewport, factor: number, anchorTime: number, anchorValue: number): GraphViewport {
  const scale = Math.max(0.5, Math.min(2, factor));
  return {
    start: anchorTime + (view.start - anchorTime) * scale,
    end: anchorTime + (view.end - anchorTime) * scale,
    min: anchorValue + (view.min - anchorValue) * scale,
    max: anchorValue + (view.max - anchorValue) * scale,
  };
}
export function panGraph(view: GraphViewport, time: number, value: number): GraphViewport {
  return { start: view.start + time, end: view.end + time, min: view.min + value, max: view.max + value };
}
