import type { Joint } from '../Joint.js';

interface RotationState {
  joint: Joint;
  base: number;
  solved: number;
}

/** Preserve the evaluated pose between passes, including stopped/untracked bones. */
export class IKPoseState {
  private readonly rotations: RotationState[] = [];
  private readonly captured = new Set<Joint>();
  private count = 0;

  /** Read the authored rotation without consuming the restoration state or changing a joint. */
  authoredRotation(joint: Joint): number {
    for (let index = 0; index < this.count; index += 1) {
      const state = this.rotations[index]!;
      if (state.joint === joint) return joint.pose.rotation === state.solved ? state.base : joint.pose.rotation;
    }
    return joint.pose.rotation;
  }

  restore(onRestore?: (joint: Joint) => void): void {
    for (let index = 0; index < this.count; index += 1) {
      const state = this.rotations[index]!;
      // An explicit external pose edit takes precedence over last pass's output.
      if (state.joint.pose.rotation === state.solved && state.solved !== state.base) {
        state.joint.pose.rotation = state.base;
        onRestore?.(state.joint);
      }
    }
    this.count = 0;
    this.captured.clear();
  }

  capture(joints: Iterable<Joint>): void {
    this.count = 0;
    this.captured.clear();
    for (const joint of joints) this.captureJoint(joint);
  }

  captureJoint(joint: Joint): void {
    if (this.captured.has(joint)) return;
    this.captured.add(joint);
    let state = this.rotations[this.count];
    if (!state) {
      state = { joint, base: joint.pose.rotation, solved: joint.pose.rotation };
      this.rotations.push(state);
    } else {
      state.joint = joint;
      state.base = joint.pose.rotation;
      state.solved = joint.pose.rotation;
    }
    this.count += 1;
  }

  commit(): void {
    for (let index = 0; index < this.count; index += 1) {
      const state = this.rotations[index]!;
      state.solved = state.joint.pose.rotation;
    }
  }
}
