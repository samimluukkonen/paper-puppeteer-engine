import type { AnimationClip } from './AnimationClip.js';
import { ANIMATION_FORMAT_VERSION, parseAnimationClip } from './externalData.js';
import { type DeepReadonly, isFullyFrozen } from './readonlyData.js';
import type { Rig } from './Rig.js';

type AnimationData = DeepReadonly<AnimationClip>;
const validated = new WeakMap<AnimationData, WeakSet<Rig>>();

/** @internal Only plain enumerable data records can be projected without losing JSON diagnostics. */
export function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key === 'string' && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

/** @internal Record only snapshots already validated and deeply frozen by their ownership boundary. */
export function rememberValidatedAnimation(animation: AnimationData, rig: Rig): void {
  let rigs = validated.get(animation);
  if (!rigs) {
    rigs = new WeakSet();
    validated.set(animation, rigs);
  }
  rigs.add(rig);
}

/** @internal Validation is reusable only for the same immutable snapshot and rig. */
export function isValidatedAnimation(animation: AnimationData, rig: Rig): boolean {
  return validated.get(animation)?.has(rig) ?? false;
}

/** @internal Share validation across preview and authoring queries; mutable input remains uncached. */
export function getValidatedAnimation(animation: AnimationData, rig: Rig): AnimationData {
  if (isValidatedAnimation(animation, rig)) return animation;
  // Reject unsafe root descriptors before object spread can invoke or discard them.
  if (!isDataRecord(animation)) return parseAnimationClip(animation, rig);
  const parsed = parseAnimationClip({ version: ANIMATION_FORMAT_VERSION, ...animation }, rig);
  if (isFullyFrozen(animation)) {
    rememberValidatedAnimation(animation, rig);
    return animation;
  }
  return parsed;
}
