import { copyAnimationEvent } from './AnimationClip.js';
import type { FiredAnimationEvent } from './AnimationPlayer.js';
import { AnimationEventBudget } from './animationTimeline.js';
import { dispatchListeners } from './notifications.js';

/** Shared runtime notification delivery; own each payload and finish dispatch despite listener failures. */
export function dispatchAnimationEvents(
  events: readonly FiredAnimationEvent[],
  listeners: ReadonlySet<(event: FiredAnimationEvent) => void>,
  isActive: () => boolean = () => true,
): unknown[] {
  const errors: unknown[] = [];
  const budget = new AnimationEventBudget();
  for (const event of events) {
    // Pose hooks and preceding callbacks can register more listeners after the clock preflight.
    try {
      budget.addEvent(event, 1, listeners.size);
    } catch (error) {
      errors.push(error);
      break;
    }
    for (const error of dispatchListeners(listeners, (listener) => listener(copyAnimationEvent(event)), isActive))
      errors.push(error);
  }
  return errors;
}
