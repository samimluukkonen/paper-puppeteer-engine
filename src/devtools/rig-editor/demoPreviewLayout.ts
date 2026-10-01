import { demoAuthoringLayout } from '../../demo/demoPresentation.js';
import type { Rig } from '../../engine/Rig.js';
import type { JointTransform } from '../../engine/types.js';

/** Demo-specific, right-facing presentation applied only to the preview pose. */
export function applyDemoRightFacingPreview(puppet: {
  readonly rig: Rig;
  getBone(id: string): { pose: JointTransform };
  setRenderOrder(order: readonly string[]): unknown;
  syncPose(): void;
}): void {
  const layout = demoAuthoringLayout(puppet.rig, 'right');
  puppet.setRenderOrder(layout.order);
  for (const [id, x] of Object.entries(layout.positions)) puppet.getBone(id).pose.x = x;
  for (const [id, rotation] of Object.entries(layout.rotations)) puppet.getBone(id).pose.rotation = rotation;
  puppet.syncPose();
}
