import type { AnimationClip } from '../../engine/AnimationClip.js';
import {
  ANIMATION_FORMAT_VERSION,
  inspectAnimationDefinition,
  parseAnimationClip,
  type ValidationResult,
} from '../../engine/externalData.js';
import { JsonInputLimitError } from '../../engine/jsonInput.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import {
  getValidatedAnimation,
  isDataRecord,
  isValidatedAnimation,
  rememberValidatedAnimation,
} from '../../engine/validatedAnimation.js';
import { freezeData, isFullyFrozen } from '../shared/editorData.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';

type AnimationData = DeepReadonly<AnimationClip>;
/** Owned versioned editor snapshot; event payloads are validated as JSON before freezing. */
export type ReadonlyAnimation = AnimationData & { readonly version: typeof ANIMATION_FORMAT_VERSION };

/** Validate external data and register only the immutable snapshot created by this boundary. */
export function inspectEditorAnimation(input: unknown, rig: Rig): ValidationResult<ReadonlyAnimation> {
  const { data, ...diagnostics } = inspectAnimationDefinition(input, rig);
  if (!data) return diagnostics;
  const snapshot = freezeData<ReadonlyAnimation>({ ...data, version: ANIMATION_FORMAT_VERSION });
  try {
    assertJsonExportSize(snapshot);
  } catch (error) {
    if (!(error instanceof JsonInputLimitError)) throw error;
    return { ...diagnostics, issues: [...diagnostics.issues, { severity: 'error', message: error.message }] };
  }
  rememberValidatedAnimation(snapshot, rig);
  return { ...diagnostics, data: snapshot };
}

/** Reuse validation only after checking both the file and its deep immutability against this rig. */
export function getValidatedEditorAnimation(animation: AnimationData, rig: Rig): AnimationData {
  return getValidatedAnimation(animation, rig);
}

/** New edit branches are owned; shared branches may only be frozen when the source already is immutable. */
export function validateEditedAnimation<Animation extends AnimationData>(
  next: Animation,
  source: AnimationData,
  rig: Rig,
): Animation {
  if (
    isValidatedAnimation(source, rig) &&
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
    if (isFullyFrozen(next)) rememberValidatedAnimation(next, rig);
  } else {
    getValidatedEditorAnimation(next, rig);
  }
  assertJsonExportSize(next);
  return next;
}
