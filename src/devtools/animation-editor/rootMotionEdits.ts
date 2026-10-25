import { propertyKeyframe, withoutKeyframeProperty } from '../../engine/animationCurves.js';
import type { Rig } from '../../engine/Rig.js';
import type { RootMotionProperty } from '../../engine/rootMotion.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import { validateEditedAnimation } from './validatedAnimation.js';

export interface RootKeySelection {
  readonly property: RootMotionProperty;
  /** Editor seconds; serialized keys use milliseconds. */
  readonly time: number;
}
export function rootKeys(animation: ReadonlyAnimation, property: RootMotionProperty) {
  return (animation.rootMotion?.translationKeys ?? []).flatMap((key) =>
    key[property] === undefined ? [] : [propertyKeyframe(key, property)],
  );
}
/** Sparse property edits preserve the other axis, its curve and every skeletal/IK branch. */
export function setRootKey(
  animation: ReadonlyAnimation,
  rig: Rig,
  property: RootMotionProperty,
  time: number,
  value: number | undefined,
): ReadonlyAnimation {
  if (
    !['x', 'y'].includes(property) ||
    !Number.isFinite(time) ||
    time < 0 ||
    time > animation.duration ||
    (value !== undefined && !Number.isFinite(value))
  )
    throw new Error('Root position and time must be finite and inside the clip.');
  const rows = animation.rootMotion?.translationKeys ?? [];
  const existing = rows.find((key) => key.time === time);
  const remainder = existing ? withoutKeyframeProperty(existing, property) : { time };
  const row = value === undefined ? remainder : { ...existing, time, [property]: value };
  const keys = rows.filter((key) => key.time !== time);
  if ('x' in row || 'y' in row) keys.push(row);
  keys.sort((a, b) => a.time - b.time);
  return validateEditedAnimation({ ...animation, rootMotion: { translationKeys: keys } }, animation, rig);
}

export function duplicateRootPropertyKey(
  animation: ReadonlyAnimation,
  rig: Rig,
  key: RootKeySelection,
  time: number,
): ReadonlyAnimation {
  const source = rootKeys(animation, key.property).find((entry) => entry.time / 1000 === key.time);
  if (!source) throw new Error('The root key is no longer available.');
  const next = setRootKey(animation, rig, key.property, time * 1000, source.value);
  if (!source.curve) return next;
  return validateEditedAnimation(
    {
      ...next,
      rootMotion: {
        translationKeys: next.rootMotion!.translationKeys.map((row) =>
          row.time === time * 1000 ? { ...row, curves: { ...row.curves, [key.property]: source.curve } } : row,
        ),
      },
    },
    animation,
    rig,
  );
}
