import { localToWorld, worldToLocal, type Affine, type Point } from '../../engine/affineMath.js';

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
