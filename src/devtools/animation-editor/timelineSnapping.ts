import { ikAnimationProperties } from '../../engine/ik/animationKeyframes.js';
import { transformProperties } from '../../engine/types.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import { getAnimationEventReferences, type AnimationEventRef } from './animationEvents.js';
import type { IKKeyframeSelection } from './ikTimeline.js';
import { keyIdentity } from './keyframeSelection.js';
import { animationDurationSeconds, clampTime, DEFAULT_KEYFRAME_FPS, timelineXToTime } from './timeline.js';
import type { KeyframeSelection } from './timelineTracks.js';
import { type Seconds, toSeconds } from './timeUnits.js';

export type TimelineSnapTargetType = 'frame' | 'keyframe' | 'event' | 'playhead';
export interface TimelineSnapSettings {
  readonly enabled: boolean;
  readonly frames: boolean;
  readonly keyframes: boolean;
  readonly events: boolean;
  readonly playhead: boolean;
}
export const defaultTimelineSnapSettings: TimelineSnapSettings = Object.freeze({
  enabled: false,
  frames: true,
  keyframes: true,
  events: true,
  playhead: true,
});
export const TIMELINE_SNAP_TOLERANCE_PX = 8;

export interface TimelineSnapTarget {
  readonly type: 'keyframe' | 'event';
  readonly time: Seconds;
  readonly key?: KeyframeSelection | IKKeyframeSelection;
  readonly event?: AnimationEventRef;
}
export interface TimelineSnapGuide {
  readonly type: TimelineSnapTargetType;
  readonly time: Seconds;
}
export interface TimelineSnapResult {
  readonly time: Seconds;
  readonly targetType: TimelineSnapTargetType | null;
  readonly targetTime: Seconds | null;
  readonly guide: TimelineSnapGuide | null;
}
export interface TimelineSnapContext {
  readonly duration: Seconds;
  readonly contentWidth: number;
  readonly fps?: number;
  readonly playheadTime: Seconds;
  readonly targets: readonly TimelineSnapTarget[];
  readonly excludedKeys?: readonly (KeyframeSelection | IKKeyframeSelection)[];
  readonly excludedEvent?: AnimationEventRef;
  readonly minTime?: Seconds;
  readonly maxTime?: Seconds;
  readonly disableSnapping?: boolean;
}

function snapKeyIdentity(key: KeyframeSelection | IKKeyframeSelection): string {
  return 'kind' in key ? JSON.stringify(['ik', key.constraintId, key.property, key.time]) : `bone:${keyIdentity(key)}`;
}

/** Nearest eligible target within 8 screen pixels. Equal distances prefer playhead, event,
 * keyframe, then frame; equal type/distance prefers the earlier time. DOM/track order is irrelevant.
 * Frame targets are the authored grid; off-grid clip endpoints remain ordinary clamped times.
 */
export function resolveTimelineSnap(
  proposedTime: Seconds,
  context: TimelineSnapContext,
  settings: TimelineSnapSettings,
): TimelineSnapResult {
  const min = clampTime(context.minTime ?? 0, context.duration);
  const max = Math.max(min, clampTime(context.maxTime ?? context.duration, context.duration));
  const time = Math.max(min, Math.min(max, clampTime(proposedTime, context.duration)));
  const unsnapped: TimelineSnapResult = { time, targetType: null, targetTime: null, guide: null };
  if (
    !settings.enabled ||
    context.disableSnapping ||
    !(context.contentWidth > 0) ||
    !Number.isFinite(context.contentWidth)
  )
    return unsnapped;
  const tolerance = timelineXToTime(TIMELINE_SNAP_TOLERANCE_PX, context.duration, context.contentWidth);
  const priority: Record<TimelineSnapTargetType, number> = { playhead: 0, event: 1, keyframe: 2, frame: 3 };
  let best: TimelineSnapGuide | null = null;
  let distance = Infinity;
  let result = unsnapped;
  // Numerical equality only: this is far smaller than authored collision tolerance.
  const epsilon = Number.EPSILON * Math.max(1, context.duration) * 8;
  const consider = (type: TimelineSnapTargetType, target: Seconds): void => {
    if (!Number.isFinite(target) || target < min || target > max) return;
    const nextDistance = Math.abs(target - time);
    // Preserve existing hard endpoints/group bounds when the pointer reaches or overshoots them.
    if ((proposedTime <= min || proposedTime >= max) && nextDistance > epsilon) return;
    if (nextDistance > tolerance + epsilon) return;
    if (
      !best ||
      nextDistance < distance - epsilon ||
      (Math.abs(nextDistance - distance) <= epsilon &&
        (priority[type] < priority[best.type] || (type === best.type && target < best.time)))
    ) {
      best = { type, time: target };
      distance = nextDistance;
      result = { time: target, targetType: type, targetTime: target, guide: best };
    }
  };
  if (settings.frames) {
    const fps =
      context.fps !== undefined && Number.isFinite(context.fps) && context.fps > 0 ? context.fps : DEFAULT_KEYFRAME_FPS;
    const frame = time * fps;
    consider('frame', Math.floor(frame) / fps);
    consider('frame', Math.ceil(frame) / fps);
  }
  const excluded = new Set(context.excludedKeys?.map(snapKeyIdentity));
  for (const target of context.targets) {
    if (target.type === 'keyframe') {
      if (!settings.keyframes || (target.key && excluded.has(snapKeyIdentity(target.key)))) continue;
    } else if (!settings.events || (target.event && target.event === context.excludedEvent)) continue;
    consider(target.type, target.time);
  }
  if (settings.playhead) consider('playhead', context.playheadTime);
  return result;
}

/** Build from authored marker identities, including collapsed/filtered tracks and sparse IK properties. */
export function buildTimelineSnapTargets(animation: ReadonlyAnimation | null): readonly TimelineSnapTarget[] {
  if (!animation) return Object.freeze([]);
  const targets: TimelineSnapTarget[] = [];
  for (const [boneId, rows] of Object.entries(animation.tracks))
    for (const row of rows)
      for (const property of transformProperties)
        if (row[property] !== undefined) {
          const time = toSeconds(row.time);
          targets.push({ type: 'keyframe', time, key: { boneId, property, time } });
        }
  for (const [constraintId, rows] of Object.entries(animation.ikTracks ?? {}))
    for (const row of rows)
      for (const property of ikAnimationProperties)
        if (row[property] !== undefined) {
          const time = toSeconds(row.time);
          targets.push({ type: 'keyframe', time, key: { kind: 'ik', constraintId, property, time } });
        }
  const refs = getAnimationEventReferences(animation);
  for (const [index, event] of (animation.events ?? []).entries())
    targets.push({ type: 'event', time: toSeconds(event.time), event: refs[index]! });
  return Object.freeze(
    targets.map((target) => Object.freeze({ ...target, ...(target.key ? { key: Object.freeze(target.key) } : {}) })),
  );
}

/** Session-only preferences and geometry. Candidate markers are cached per immutable working snapshot. */
export class AnimationEditorTimelineSnapping {
  private preferences = defaultTimelineSnapSettings;
  private width: number | undefined;
  private animation: ReadonlyAnimation | null = null;
  private targets: readonly TimelineSnapTarget[] = [];
  constructor(
    private readonly getAnimation: () => ReadonlyAnimation | null,
    private readonly notify: () => void,
  ) {}
  get settings(): TimelineSnapSettings {
    return this.preferences;
  }
  get fps(): number {
    const playback = this.getAnimation()?.playback;
    return playback?.mode === 'stepped' ? playback.fps : DEFAULT_KEYFRAME_FPS;
  }
  setSettings(patch: Partial<TimelineSnapSettings>): void {
    const next = { ...this.preferences };
    for (const field of ['enabled', 'frames', 'keyframes', 'events', 'playhead'] as const)
      if (typeof patch[field] === 'boolean') next[field] = patch[field];
    if (
      Object.keys(next).every(
        (field) => next[field as keyof TimelineSnapSettings] === this.preferences[field as keyof TimelineSnapSettings],
      )
    )
      return;
    this.preferences = Object.freeze(next);
    this.notify();
  }
  setContentWidth(width: number): void {
    this.width = width;
  }
  resolve(
    time: Seconds,
    context: Pick<
      TimelineSnapContext,
      'playheadTime' | 'excludedKeys' | 'excludedEvent' | 'minTime' | 'maxTime' | 'disableSnapping'
    >,
  ): TimelineSnapResult {
    const animation = this.getAnimation();
    if (animation !== this.animation) {
      this.animation = animation;
      this.targets = buildTimelineSnapTargets(animation);
    }
    const duration = animationDurationSeconds(animation);
    return resolveTimelineSnap(
      time,
      {
        ...context,
        duration,
        fps: this.fps,
        contentWidth: this.width ?? duration * 100,
        targets: this.targets,
      },
      this.preferences,
    );
  }
}
