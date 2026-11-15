import { animationClipSchema } from '../../engine/core.js';
import type { Interpolation, PropertyCurve, Rig } from '../../engine/data.js';
import { findBonePropertyKeyframe, findNextBonePropertyKeyframe } from './keyframeQueries.js';
import type { AnimationData } from './keyframeTargets.js';
import type { KeyframeSelection } from './timelineTracks.js';
import { toMilliseconds, toSeconds } from './timeUnits.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

/** Authored segment metadata only. Playback sample timing is deliberately independent. */
export interface SegmentInterpolation {
  readonly scope: 'clip' | 'property';
  readonly mode: PropertyCurve['mode'];
  readonly curve?: PropertyCurve;
  /** Canonical property references in editor seconds; start identifies the outgoing segment. */
  readonly start: KeyframeSelection;
  readonly end: KeyframeSelection;
}

export type InterpolationUnavailableReason =
  | 'no-animation'
  | 'empty-selection'
  | 'missing-key'
  | 'no-outgoing-segment'
  | 'property-curves';

/** Existing controls edit only the clip default. Property curve edits use the separate, channel-scoped Graph Editor API. */
export type InterpolationSelectionState =
  | { readonly kind: 'uniform'; readonly scope: 'clip'; readonly mode: Interpolation }
  | { readonly kind: 'unavailable'; readonly reason: InterpolationUnavailableReason };

export function getAnimationInterpolation(animation: AnimationData | null): Interpolation | undefined {
  return animation ? (animation.interpolation ?? 'linear') : undefined;
}

/** An optional start-key curve overrides the clip's declaration/default on this property.
 * Last keys and one-key property timelines have no outgoing segment, including in looping clips.
 */
export function getSegmentInterpolation(
  animation: AnimationData | null,
  ref: KeyframeSelection,
): SegmentInterpolation | undefined {
  if (!animation) return undefined;
  const start = findBonePropertyKeyframe(animation, ref.boneId, ref.property, toMilliseconds(ref.time));
  if (!start) return undefined;
  // Inspect sparse authored rows, not sampled poses. Exact canonical times keep nearby distinct keys intact.
  const end = findNextBonePropertyKeyframe(animation, ref.boneId, ref.property, start.time);
  if (!end) return undefined;
  return {
    scope: start.curve ? 'property' : 'clip',
    mode: start.curve?.mode ?? getAnimationInterpolation(animation)!,
    ...(start.curve ? { curve: start.curve } : {}),
    start: { boneId: ref.boneId, property: ref.property, time: toSeconds(start.time) },
    end: { boneId: ref.boneId, property: ref.property, time: toSeconds(end.time) },
  };
}

/** All requested refs must identify outgoing property segments; do not silently drop unavailable keys. */
export function getInterpolationForKeys(
  animation: AnimationData | null,
  keys: readonly KeyframeSelection[],
): InterpolationSelectionState {
  if (!animation) return { kind: 'unavailable', reason: 'no-animation' };
  if (!keys.length) return { kind: 'unavailable', reason: 'empty-selection' };
  let terminal = false;
  let propertyCurves = false;
  for (const ref of keys) {
    if (!findBonePropertyKeyframe(animation, ref.boneId, ref.property, toMilliseconds(ref.time)))
      return { kind: 'unavailable', reason: 'missing-key' };
    const segment = getSegmentInterpolation(animation, ref);
    if (!segment) terminal = true;
    if (segment?.scope === 'property') propertyCurves = true;
  }
  // Missing identities take precedence over terminal segments, regardless of selection order.
  if (terminal) return { kind: 'unavailable', reason: 'no-outgoing-segment' };
  if (propertyCurves) return { kind: 'unavailable', reason: 'property-curves' };
  return { kind: 'uniform', scope: 'clip', mode: getAnimationInterpolation(animation)! };
}

/** Pure clip-level authored edit. Undefined removes the declaration, retaining the linear default.
 * Inputs are never mutated/frozen; keys, events, playback and unrelated branches retain their identity.
 */
export function setAnimationInterpolation<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  mode: Interpolation | undefined,
): Omit<Animation, 'interpolation'> & AnimationData {
  if (mode !== undefined) animationClipSchema.shape.interpolation.unwrap().parse(mode);
  getValidatedEditorAnimation(animation, rig);
  if (animation.interpolation === mode) return animation;
  const next = { ...animation, interpolation: mode ?? 'linear' };
  // Delete only from the fresh root, including when the input's type declares a readonly field.
  if (mode === undefined) Reflect.deleteProperty(next, 'interpolation');
  return validateEditedAnimation(next, animation, rig);
}

export interface UnavailableInterpolationEdit<Animation extends AnimationData> {
  readonly kind: 'unavailable';
  readonly reason: 'clip-only' | InterpolationUnavailableReason;
  readonly animation: Animation;
}

/** Atomic capability boundary for the legacy selection inspector. Existing controls cannot edit individual keys.
 * Never promote a selection edit into a clip edit, which would affect unrelated segments.
 */
export function setInterpolationForKeys<Animation extends AnimationData>(
  animation: Animation,
  keys: readonly KeyframeSelection[],
  mode: Interpolation,
): UnavailableInterpolationEdit<Animation> {
  animationClipSchema.shape.interpolation.unwrap().parse(mode);
  const selection = getInterpolationForKeys(animation, keys);
  return {
    kind: 'unavailable',
    reason: selection.kind === 'unavailable' ? selection.reason : 'clip-only',
    animation,
  };
}
