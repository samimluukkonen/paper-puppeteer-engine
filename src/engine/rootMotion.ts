import { sampleProperty, type AnimationClip, type PropertyKeyframe } from './AnimationClip.js';
import { propertyKeyframe, type PropertyCurves } from './animationCurves.js';
import { isFullyFrozen } from './readonlyData.js';
import { assertFinite } from './types.js';

export const ROOT_MOTION_PROPERTIES = ['x', 'y'] as const;
export type RootMotionProperty = (typeof ROOT_MOTION_PROPERTIES)[number];

/** Sparse animation-local offsets. Identity follows bone/IK keys: property plus millisecond time. */
export interface RootMotionKey {
  readonly time: number;
  readonly x?: number;
  readonly y?: number;
  readonly curves?: PropertyCurves<RootMotionProperty>;
}

export interface RootMotionDefinition {
  readonly translationKeys: readonly RootMotionKey[];
}

export interface RootMotionOffset {
  readonly x: number;
  readonly y: number;
}

type RootMotionClip = Pick<AnimationClip, 'duration' | 'rootMotion'>;
type PropertyTracks = Readonly<Record<RootMotionProperty, readonly PropertyKeyframe[]>>;
const propertyTracks = new WeakMap<readonly RootMotionKey[], PropertyTracks>();

/** Compile sparse channels once for immutable animation snapshots; mutable callers remain uncached. */
function channels(keys: readonly RootMotionKey[]): PropertyTracks {
  const cached = propertyTracks.get(keys);
  if (cached) return cached;
  const result: PropertyTracks = {
    x: keys.flatMap((key) => (key.x === undefined ? [] : [propertyKeyframe(key, 'x')])),
    y: keys.flatMap((key) => (key.y === undefined ? [] : [propertyKeyframe(key, 'y')])),
  };
  if (isFullyFrozen(keys)) propertyTracks.set(keys, result);
  return result;
}

/** Raw offsets from validated animation data, clamped without wrapping or playback quantization.
 * Facing/scale/world transforms are deliberately left to an explicit application owner.
 */
export function sampleRootMotion(clip: RootMotionClip, time: number): RootMotionOffset {
  assertFinite(time, 'Root motion sample time');
  const keys = clip.rootMotion?.translationKeys;
  if (!keys?.length) return { x: 0, y: 0 };
  const tracks = channels(keys);
  const bounded = Math.max(0, Math.min(clip.duration, time));
  return {
    x: tracks.x.length ? sampleProperty(tracks.x, bounded) : 0,
    y: tracks.y.length ? sampleProperty(tracks.y, bounded) : 0,
  };
}

/** Absolute displacement relative to the initial sample, so starting a clip cannot teleport it.
 * Net cycle displacement is evaluateRootMotion(clip, clip.duration). This never moves an Actor.
 */
export function evaluateRootMotion(clip: RootMotionClip, time: number): RootMotionOffset {
  const offset = sampleRootMotion(clip, time);
  const initial = sampleRootMotion(clip, 0);
  const x = offset.x - initial.x;
  const y = offset.y - initial.y;
  assertFinite(x, 'Root motion displacement x');
  assertFinite(y, 'Root motion displacement y');
  return { x, y };
}
