import type { AnimationClip } from '../../engine/AnimationClip.js';
import { ANIMATION_FORMAT_VERSION, parseAnimationClip } from '../../engine/externalData.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { freezeData, isFullyFrozen } from '../shared/editorData.js';

type AnimationData = DeepReadonly<AnimationClip>;
const validated = new WeakMap<AnimationData, WeakSet<Rig>>();

function rememberValidated(animation: AnimationData, rig: Rig): void {
  let rigs = validated.get(animation);
  if (!rigs) {
    rigs = new WeakSet();
    validated.set(animation, rigs);
  }
  rigs.add(rig);
}

/** Only plain enumerable data records can be projected without losing JSON diagnostics. */
function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key === 'string' && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

/** Reuse validation only after checking both the file and its deep immutability against this rig. */
export function getValidatedEditorAnimation(animation: AnimationData, rig: Rig): AnimationData {
  if (validated.get(animation)?.has(rig)) return animation;
  // Reject unsafe root descriptors before object spread can invoke or discard them.
  if (!isDataRecord(animation)) return parseAnimationClip(animation, rig);
  const parsed = parseAnimationClip({ version: ANIMATION_FORMAT_VERSION, ...animation }, rig);
  if (isFullyFrozen(animation)) {
    rememberValidated(animation, rig);
    return animation;
  }
  return parsed;
}

/** New edit branches are owned; shared branches may only be frozen when the source already is immutable. */
export function validateEditedAnimation<Animation extends AnimationData>(
  next: Animation,
  source: AnimationData,
  rig: Rig,
): Animation {
  if (
    validated.get(source)?.has(rig) &&
    isDataRecord(next) &&
    isDataRecord(next.tracks) &&
    next.duration === source.duration
  ) {
    const tracks = Object.fromEntries(
      Object.entries(next.tracks).filter(
        ([bone, keys]) => !Object.hasOwn(source.tracks, bone) || keys !== source.tracks[bone],
      ),
    );
    // Duration and rig are unchanged, so shared tracks and events retain their validation.
    // All metadata and changed branches still pass the ordinary strict file validator.
    const reuseEvents =
      next.events === source.events && Object.hasOwn(next, 'events') === Object.hasOwn(source, 'events');
    parseAnimationClip(
      {
        version: ANIMATION_FORMAT_VERSION,
        ...next,
        tracks,
        ...(reuseEvents && next.events !== undefined ? { events: [] } : {}),
      },
      rig,
    );
    freezeData(next);
    if (isFullyFrozen(next)) rememberValidated(next, rig);
  } else {
    getValidatedEditorAnimation(next, rig);
  }
  return next;
}
