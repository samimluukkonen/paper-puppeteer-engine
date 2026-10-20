import { z } from 'zod';
import { editorWorldViewport, type EditorViewportCamera } from './editorCamera.js';
import { CHARACTER_PREVIEW_ORIGIN } from './previewPlacement.js';

/** These domains have different origins. Transferring a Y requires an explicit workspace transform. */
export type GroundGuideSpace = 'animation-preview-world' | 'scene-world';

export const groundGuideSchema = z.strictObject({
  enabled: z.boolean(),
  y: z.number().finite(),
  snapEnabled: z.boolean(),
});

/** Editor metadata only. snapEnabled opts into IK target (animation) or Actor feet (scene) drag snapping. */
export type GroundGuide = Readonly<z.infer<typeof groundGuideSchema>>;

export function defaultGroundGuide(space: GroundGuideSpace): GroundGuide {
  return Object.freeze({
    enabled: false,
    y: space === 'animation-preview-world' ? CHARACTER_PREVIEW_ORIGIN.y : 0,
    snapEnabled: false,
  });
}

/** Invalid numbers/flags retain the last valid setting; no authored document is touched. */
export function updateGroundGuide(current: GroundGuide, patch: Partial<GroundGuide>): GroundGuide {
  return Object.freeze({
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    y: typeof patch.y === 'number' && Number.isFinite(patch.y) ? patch.y : current.y,
    snapEnabled: typeof patch.snapEnabled === 'boolean' ? patch.snapEnabled : current.snapEnabled,
  });
}

/** World-space geometry for the editors' unrotated, uniformly zoomed cameras. */
export function groundGuideGeometry(guide: GroundGuide, camera: EditorViewportCamera) {
  const view = editorWorldViewport(camera);
  if (!guide.enabled || !Number.isFinite(guide.y) || !view || guide.y < view.top || guide.y > view.bottom) return null;
  const pixel = 1 / camera.zoom;
  return {
    left: view.left,
    right: view.right,
    y: guide.y,
    pixel,
    labelX: view.left + 12 * pixel,
    labelY: guide.y - view.top >= 24 * pixel ? guide.y - 22 * pixel : guide.y + 4 * pixel,
  };
}

/** Only the dedicated label is draggable; the line never steals joint/IK picks. */
export function groundGuideHandleHit(
  guide: GroundGuide,
  camera: EditorViewportCamera,
  world: { x: number; y: number },
): boolean {
  const geometry = groundGuideGeometry(guide, camera);
  return (
    !!geometry &&
    world.x >= geometry.labelX &&
    world.x <= geometry.labelX + 80 * geometry.pixel &&
    world.y >= geometry.labelY &&
    world.y <= geometry.labelY + 20 * geometry.pixel
  );
}
