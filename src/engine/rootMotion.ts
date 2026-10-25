import {
  sampleProperty,
  type AnimationClip,
  type AnimationPlaybackMode,
  type PropertyKeyframe,
} from './AnimationClip.js';
import { propertyKeyframe, type PropertyCurves } from './animationCurves.js';
import { quantizePlaybackTime } from './animationMath.js';
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

type RootMotionClip = Pick<AnimationClip, 'duration' | 'rootMotion'> &
  Partial<Pick<AnimationClip, 'loop' | 'playback'>>;

export type RootMotionPolicy = 'ignore' | 'apply';

export interface RootMotionPlaybackOptions {
  /** Continuous cycles by default when clip.loop is true; false clamps to the endpoint. */
  readonly loop?: boolean;
  /** Optional playback quantization; a clip override takes precedence. Omit for raw interpolation. */
  readonly playback?: AnimationPlaybackMode;
}

/** One translation owner supplied by a runtime host. Sampling never invokes this application API. */
export interface RootMotionApplication {
  /** Reject conflicting translation ownership before playback changes. */
  validate(): void;
  /** Capture the current placement and linear transform for a fresh base playback. */
  begin(): void;
  /** Set placement from that captured origin plus absolute displacement, before pose/IK sync. */
  apply(displacement: RootMotionOffset): void;
}
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

/** Explicit local-time spelling; clamps and never wraps, even for looping clips. */
export const evaluateRootMotionAtTime = evaluateRootMotion;

/** Absolute displacement at unwrapped elapsed milliseconds, independent of previous frames.
 * Continuous loops add floor(elapsed / duration) times the net start-to-end displacement.
 * Authored reversals/resets remain visible; this does not extract or repair forward travel.
 */
export function evaluateRootMotionAtElapsedTime(
  clip: RootMotionClip,
  elapsedTime: number,
  options: RootMotionPlaybackOptions = {},
): RootMotionOffset {
  assertFinite(elapsedTime, 'Root motion elapsed time');
  assertFinite(clip.duration, 'Root motion duration');
  if (clip.duration <= 0) throw new Error('Root motion duration must be positive.');
  const elapsed = Math.max(0, elapsedTime);
  const loop = options.loop ?? clip.loop ?? false;
  if (typeof loop !== 'boolean') throw new Error('Root motion loop must be a boolean.');
  let cycles = loop ? Math.floor(elapsed / clip.duration) : 0;
  if (!Number.isSafeInteger(cycles)) throw new Error('Root motion cycle count must be a safe integer.');
  // Correct division against representable cycle boundaries, as the event clock does.
  // Modulo can report nearly duration at an exact boundary (e.g. 1 % 0.1).
  if (loop) {
    while (cycles * clip.duration > elapsed) --cycles;
    while ((cycles + 1) * clip.duration <= elapsed) {
      ++cycles;
      if (!Number.isSafeInteger(cycles)) throw new Error('Root motion cycle count must be a safe integer.');
    }
  }
  const localTime = loop ? elapsed - cycles * clip.duration : Math.min(elapsed, clip.duration);
  const playback = options.playback ? (clip.playback ?? options.playback) : undefined;
  if (playback) {
    if (playback.mode === 'stepped') {
      assertFinite(playback.fps, 'Root motion FPS');
      if (playback.fps <= 0) throw new Error('Root motion FPS must be positive.');
    } else if (playback.mode !== 'smooth') throw new Error('Unsupported root motion playback mode.');
  }
  const sampleTime = playback && localTime !== clip.duration ? quantizePlaybackTime(localTime, playback) : localTime;
  const local = evaluateRootMotion(clip, sampleTime);
  const net = cycles ? evaluateRootMotion(clip, clip.duration) : { x: 0, y: 0 };
  const x = local.x + cycles * net.x;
  const y = local.y + cycles * net.y;
  assertFinite(x, 'Root motion accumulated x');
  assertFinite(y, 'Root motion accumulated y');
  return { x, y };
}

/** Both positions are UNWRAPPED elapsed milliseconds, never wrapped local clip times.
 * Backward differences are supported for tools; forward runtime application uses its own clock.
 */
export function getRootMotionDelta(
  clip: RootMotionClip,
  previousElapsedTime: number,
  currentElapsedTime: number,
  options: RootMotionPlaybackOptions = {},
): RootMotionOffset {
  const previous = evaluateRootMotionAtElapsedTime(clip, previousElapsedTime, options);
  const current = evaluateRootMotionAtElapsedTime(clip, currentElapsedTime, options);
  const x = current.x - previous.x;
  const y = current.y - previous.y;
  assertFinite(x, 'Root motion delta x');
  assertFinite(y, 'Root motion delta y');
  return { x, y };
}
