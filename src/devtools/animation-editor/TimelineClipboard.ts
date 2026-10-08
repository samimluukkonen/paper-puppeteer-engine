import { copyAnimationEvent, type AnimationEvent } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { freezeData } from '../shared/editorData.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import {
  addAnimationEvent,
  findAnimationEvent,
  getAnimationEventReferences,
  type AnimationEventRef,
} from './animationEvents.js';
import type { KeyframeClipboard } from './keyframeClipboard.js';
import type { Milliseconds } from './timeUnits.js';

export interface EventClipboard {
  readonly event: DeepReadonly<AnimationEvent>;
}

export type TimelineClipboardContent =
  | { readonly kind: 'keyframes'; readonly data: KeyframeClipboard }
  | { readonly kind: 'event'; readonly data: EventClipboard };

/** One session clipboard, independent of animation identity and transient selections. */
export class TimelineClipboard {
  content: TimelineClipboardContent | null = null;
}

export function copyEventSelection(animation: ReadonlyAnimation, ref: AnimationEventRef): EventClipboard | null {
  const event = findAnimationEvent(animation, ref);
  return event ? freezeData({ event: copyAnimationEvent(event) }) : null;
}

/** Destination validation, JSON ownership and stable same-time ordering belong to the event mutation API. */
export function pasteEventClipboard(
  animation: ReadonlyAnimation,
  rig: Rig,
  clipboard: EventClipboard,
  time: Milliseconds,
): { animation: ReadonlyAnimation; ref: AnimationEventRef } {
  const previous = new Set(getAnimationEventReferences(animation));
  const next = addAnimationEvent(animation, rig, { ...clipboard.event, time });
  return { animation: next, ref: getAnimationEventReferences(next).find((ref) => !previous.has(ref))! };
}
