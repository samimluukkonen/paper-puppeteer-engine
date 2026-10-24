import { z } from 'zod';

/** Scene pixels, Y down. x/y are the frame CENTER, never Phaser scroll offsets. */
export const CINEMATIC_CAMERA_MIN_ZOOM = 0.1;
export const CINEMATIC_CAMERA_MAX_ZOOM = 8;
/** Matches the Scene Editor's existing FIT canvas; output aspect is always 10:7. */
export const SCENE_OUTPUT_VIEWPORT = Object.freeze({ width: 1000, height: 700 });
export const cinematicCameraSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  zoom: z.number().min(CINEMATIC_CAMERA_MIN_ZOOM).max(CINEMATIC_CAMERA_MAX_ZOOM),
});
export type CinematicCameraState = z.infer<typeof cinematicCameraSchema>;
export const DEFAULT_CINEMATIC_CAMERA: Readonly<CinematicCameraState> = Object.freeze({ x: 0, y: 0, zoom: 1 });
export interface CameraViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
/** Small structural subset implemented by Phaser.Cameras.Scene2D.Camera. No renderer/React dependency. */
export interface CinematicCameraTarget {
  readonly width: number;
  readonly height: number;
  setViewport(x: number, y: number, width: number, height: number): unknown;
  setZoom(zoom: number): unknown;
  centerOn(x: number, y: number): unknown;
}
export function cinematicFrame(state: Readonly<CinematicCameraState> = DEFAULT_CINEMATIC_CAMERA) {
  const { x, y, zoom } = cinematicCameraSchema.parse(state);
  const width = SCENE_OUTPUT_VIEWPORT.width / zoom;
  const height = SCENE_OUTPUT_VIEWPORT.height / zoom;
  return { x: x - width / 2, y: y - height / 2, width, height };
}
/** Fit reliable rendered bounds with 20% breathing room, clamping authored zoom. */
export function cameraForBounds(bounds: CameraViewport): CinematicCameraState {
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    throw new Error('Camera framing needs finite, positive rendered bounds.');
  return cinematicCameraSchema.parse({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    zoom: Math.max(
      CINEMATIC_CAMERA_MIN_ZOOM,
      Math.min(
        CINEMATIC_CAMERA_MAX_ZOOM,
        SCENE_OUTPUT_VIEWPORT.width / (bounds.width * 1.2),
        SCENE_OUTPUT_VIEWPORT.height / (bounds.height * 1.2),
      ),
    ),
  });
}
/** Explicit host-owned application. Reapply with the full host viewport after resize.
 * Uses a centered, unrotated Phaser camera; letterboxes without stretching scene content.
 */
export function applyCinematicCamera(
  camera: CinematicCameraTarget,
  state: Readonly<CinematicCameraState> = DEFAULT_CINEMATIC_CAMERA,
  viewport: CameraViewport = { x: 0, y: 0, width: camera.width, height: camera.height },
): CameraViewport {
  const parsed = cinematicCameraSchema.parse(state);
  if (
    ![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    throw new Error('Camera viewport must be finite with positive dimensions.');
  const fit = Math.min(viewport.width / SCENE_OUTPUT_VIEWPORT.width, viewport.height / SCENE_OUTPUT_VIEWPORT.height);
  const width = SCENE_OUTPUT_VIEWPORT.width * fit;
  const height = SCENE_OUTPUT_VIEWPORT.height * fit;
  const result = {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height,
  };
  camera.setViewport(result.x, result.y, width, height);
  camera.setZoom(parsed.zoom * fit);
  camera.centerOn(parsed.x, parsed.y);
  return result;
}
