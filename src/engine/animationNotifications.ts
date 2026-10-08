import { copyAnimationEvent } from './AnimationClip.js';
import type { FiredAnimationEvent } from './AnimationPlayer.js';

/** Shared runtime notification delivery; own each payload and finish dispatch despite listener failures. */
export function dispatchAnimationEvents(
  events: readonly FiredAnimationEvent[],
  listeners: ReadonlySet<(event: FiredAnimationEvent) => void>,
  isActive: () => boolean = () => true,
): unknown[] {
  const errors: unknown[] = [];
  for (const event of events) {
    // oxlint-disable-next-line unicorn/no-useless-spread -- Snapshot listeners during callback mutations.
    for (const listener of [...listeners]) {
      if (!isActive()) break;
      try {
        listener(copyAnimationEvent(event));
      } catch (error) {
        errors.push(error);
      }
    }
  }
  return errors;
}
