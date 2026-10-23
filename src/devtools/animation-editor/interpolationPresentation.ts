import type { Interpolation } from '../../engine/AnimationClip.js';
import type { PropertyCurve } from '../../engine/animationCurves.js';
import { animationClipSchema } from '../../engine/schemas.js';
import type { InterpolationSelectionState, InterpolationUnavailableReason } from './interpolation.js';

/** Derive options from the authoritative authored schema, independently of playback sampling modes. */
export const AUTHORED_INTERPOLATION_MODES: readonly Interpolation[] = Object.freeze([
  animationClipSchema.shape.interpolation.unwrap().value,
]);

export function interpolationLabel(mode: PropertyCurve['mode']): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

const unavailableHelp: Record<InterpolationUnavailableReason, string> = {
  'property-curves':
    'The selection contains property curve overrides. Open Graph Editor to edit their outgoing segments.',
  'no-animation': 'Select an animation to inspect interpolation.',
  'empty-selection': 'Select a key to inspect its outgoing interpolation.',
  'missing-key': 'A selected key is no longer available.',
  'no-outgoing-segment':
    'A selected key has no outgoing segment. Select keys with a following key on the same property.',
};

/** The current capability boundary is clip-only; a key selection must never become a clip edit. */
export function selectedInterpolationControl(selection: InterpolationSelectionState): {
  readonly value: Interpolation | '';
  readonly disabled: boolean;
  readonly reason: InterpolationUnavailableReason | 'clip-only';
  readonly help: string;
} {
  if (selection.kind === 'unavailable')
    return { value: '', disabled: true, reason: selection.reason, help: unavailableHelp[selection.reason] };
  return {
    value: selection.mode,
    disabled: true,
    reason: 'clip-only',
    help: `${interpolationLabel(selection.mode)} is inherited from the clip. Open Graph Editor to edit this property’s outgoing segment.`,
  };
}
