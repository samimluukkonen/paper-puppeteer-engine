import type { Joint } from '../Joint.js';

interface RotationState {
  joint: Joint;
  base: number;
  solved: number;
}

/** Preserve the evaluated pose between passes, including stopped/untracked bones. */
export class IKPoseState {
  private readonly rotations: RotationState[] = [];

  restore(): void {
    for (const state of this.rotations) {
      // An explicit external pose edit takes precedence over last pass's output.
      if (state.joint.pose.rotation === state.solved) state.joint.pose.rotation = state.base;
    }
    this.rotations.length = 0;
  }

  capture(joints: Iterable<Joint>): void {
    this.rotations.length = 0;
    for (const joint of new Set(joints)) {
      this.rotations.push({ joint, base: joint.pose.rotation, solved: joint.pose.rotation });
    }
  }

  commit(): void {
    for (const state of this.rotations) state.solved = state.joint.pose.rotation;
  }
}
