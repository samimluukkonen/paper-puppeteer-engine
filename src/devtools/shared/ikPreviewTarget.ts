import { localToWorld, type Point } from '../../engine/affineMath.js';
import type { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import type { Puppet } from '../../engine/Puppet.js';

/** Pin the solver's actual endpoint, including authored overrides and the end bone's transform. */
export function ikPreviewTarget(puppet: Puppet, constraint: TwoBoneIKConstraint): Point {
  return localToWorld(constraint.endOffset, puppet.getBone(constraint.endBone).container.getWorldTransformMatrix());
}
