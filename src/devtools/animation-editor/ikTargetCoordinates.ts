import { localToWorld, worldToLocal, type Affine, type Point } from '../../engine/affineMath.js';
import type { GroundGuide } from '../shared/groundGuide.js';

/** Camera projection first, then the full puppet placement/facing/enclosing-container inverse. */
export function pointerToIKTarget(
  pointer: Point,
  camera: { getWorldPoint(x: number, y: number): Point },
  puppetMatrix: Affine,
): Point | undefined {
  return worldToLocal(camera.getWorldPoint(pointer.x, pointer.y), puppetMatrix);
}

export function ikTargetToWorld(target: Point, puppetMatrix: Affine): Point {
  return localToWorld(target, puppetMatrix);
}

/** Preserve requested world X, align requested world Y. No sole-contact inference. */
export function alignIKTargetToGuide(target: Point, puppetMatrix: Affine, y: number): Point | undefined {
  const world = localToWorld(target, puppetMatrix);
  return worldToLocal({ x: world.x, y }, puppetMatrix);
}

/** Snapping affects an explicit target drag's temporary draft only. */
export function snapIKTargetToGuide(target: Point, puppetMatrix: Affine, guide: GroundGuide, zoom: number): Point {
  const world = localToWorld(target, puppetMatrix);
  if (!guide.enabled || !guide.snapEnabled || !(zoom > 0) || Math.abs(world.y - guide.y) * zoom > 8) return target;
  return alignIKTargetToGuide(target, puppetMatrix, guide.y) ?? target;
}
