import type { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';

/** Presentation of the existing solver result; never evaluates or modifies a constraint. */
export function rigIKFeedback(
  constraint: Pick<TwoBoneIKConstraint, 'status' | 'enabled'>,
  definition: Pick<TwoBoneIKDefinition, 'enabled'>,
) {
  if (definition.enabled === false)
    return { label: 'Disabled', detail: 'Enable this constraint to solve it. Its default target remains editable.' };
  if (!constraint.enabled)
    return { label: 'Solver off', detail: 'Enable Live solver preview to evaluate this constraint.' };
  switch (constraint.status) {
    case 'solved':
      return { label: 'Reachable', detail: 'The target is within reach. Influence blends the solved pose with FK.' };
    case 'clamped':
      return {
        label: 'Unreachable target',
        detail:
          'The solver clamps the pose to its reach limits. Move the target closer to the reachable range; authored coordinates are retained.',
      };
    case 'singular-transform':
      return {
        label: 'Cannot solve',
        detail: 'A transform has a zero scale or cannot be inverted. Restore nonzero scales.',
      };
    case 'unsupported-scale':
      return {
        label: 'Unsupported scale',
        detail: 'The IK start bone needs equal absolute X and Y scales. Nonuniform ancestor transforms are supported.',
      };
    case 'inactive':
      return {
        label: 'Inactive',
        detail: 'No active target or influence. Check the target, Influence and animation constraint suppression.',
      };
  }
}
