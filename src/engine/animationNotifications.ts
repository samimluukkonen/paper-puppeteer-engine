import { copyAnimationEvent } from './AnimationClip.js';
import type { FiredAnimationEvent } from './AnimationPlayer.js';
import { dispatchListeners } from './notifications.js';

/** Shared runtime notification delivery; own each payload and finish dispatch despite listener failures. */
export function dispatchAnimationEvents(
  events: readonly FiredAnimationEvent[],
  listeners: ReadonlySet<(event: FiredAnimationEvent) => void>,
  isActive: () => boolean = () => true,
): unknown[] {
  const errors: unknown[] = [];
  for (const event of events) {
    for (const error of dispatchListeners(listeners, (listener) => listener(copyAnimationEvent(event)), isActive))
      errors.push(error);
  }
  return errors;
}
