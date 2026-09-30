import type { JointTransform } from './types.js';
import { createTransform } from './types.js';

/** Renderer-independent pose, also usable by future constraints or IK solvers. */
export class Joint {
  readonly bindPose: Readonly<JointTransform>;
  readonly pose: JointTransform;

  constructor(
    readonly id: string,
    transform: Partial<JointTransform> = {},
  ) {
    this.bindPose = Object.freeze(createTransform(transform));
    this.pose = createTransform(transform);
  }

  reset(): void {
    Object.assign(this.pose, this.bindPose);
  }
}
