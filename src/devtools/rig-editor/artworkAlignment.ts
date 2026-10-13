import { worldToLocal, type Affine, type Point } from './coordinates.js';

export function originPixels(origin: number, dimension: number): number {
  return origin * dimension;
}

export function normalizedOrigin(pixels: number, dimension: number): number {
  if (!Number.isFinite(dimension) || dimension <= 0) throw new Error('Artwork dimensions must be positive.');
  const value = pixels / dimension;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Origin must lie within the image.');
  return value;
}

/** Texture coordinates start at the top-left, while Phaser image-local zero is its pivot.
 * Capture the image matrix and origin at gesture start: preview origins must not feed back into conversion.
 */
export function textureOriginAt(world: Point, imageMatrix: Affine, origin: Point, size: Point): Point | undefined {
  const local = worldToLocal(world, imageMatrix);
  if (!local || size.x <= 0 || size.y <= 0) return undefined;
  return {
    x: Math.max(0, Math.min(1, origin.x + local.x / size.x)),
    y: Math.max(0, Math.min(1, origin.y + local.y / size.y)),
  };
}
