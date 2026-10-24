import { z } from 'zod';
import { sampleProperty } from './AnimationClip.js';
import {
  CINEMATIC_CAMERA_MAX_ZOOM,
  CINEMATIC_CAMERA_MIN_ZOOM,
  DEFAULT_CINEMATIC_CAMERA,
  type CinematicCameraState,
} from './cinematicCamera.js';
import type { DeepReadonly } from './readonlyData.js';
import type { SceneDefinition } from './SceneDefinition.js';
import { identifierSchema, propertyCurveSchema } from './schemas.js';
import { assertFinite } from './types.js';

export const CAMERA_PROPERTIES = ['x', 'y', 'zoom'] as const;
export type CameraProperty = (typeof CAMERA_PROPERTIES)[number];
/** Same scalar rows and outgoing curves as the animation property sampler. Time is milliseconds. */
export const cameraKeyframeSchema = z.strictObject({
  id: identifierSchema,
  time: z.number().nonnegative(),
  value: z.number(),
  curve: propertyCurveSchema.exactOptional(),
});
export type CameraKeyframe = z.infer<typeof cameraKeyframeSchema>;
const track = z.array(cameraKeyframeSchema).max(10000);
export const cameraTracksSchema = z.strictObject({
  x: track.exactOptional(),
  y: track.exactOptional(),
  zoom: track.exactOptional(),
});
export type CameraTracks = z.infer<typeof cameraTracksSchema>;

/** Stateless scene-clock sampling. Empty channels use initial settings; keyed channels hold
 * their first/last value outside their key range, exactly like character property tracks.
 * Validated zoom keys and bounded Bézier progress cannot overshoot [0.1, 8]. Clamp the
 * final zoom as a numerical safety net, without changing shared curve solver semantics.
 */
export function evaluateCameraAtTime(scene: DeepReadonly<SceneDefinition>, time: number): CinematicCameraState {
  assertFinite(time, 'Camera sample time');
  const result = { ...(scene.camera ?? DEFAULT_CINEMATIC_CAMERA) };
  const bounded = Math.max(0, Math.min(scene.duration, time));
  for (const property of CAMERA_PROPERTIES) {
    const keys = scene.cameraTracks?.[property];
    if (keys?.length) result[property] = sampleProperty(keys, bounded);
  }
  result.zoom = Math.max(CINEMATIC_CAMERA_MIN_ZOOM, Math.min(CINEMATIC_CAMERA_MAX_ZOOM, result.zoom));
  return result;
}
