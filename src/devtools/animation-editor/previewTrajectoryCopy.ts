import { worldToLocal, type Affine } from '../../engine/affineMath.js';
import type { RootMotionDefinition } from '../../engine/rootMotion.js';
import { evaluatePreviewDisplacement, validPreviewPositionKeys, type MotionPreviewSettings } from './motionPreview.js';
import { rootMotionMatrix } from './rootMotionCoordinates.js';

/** Piecewise affine conversion preserves both linear and stepped segments and endpoint holds. */
export function previewTrajectoryToRootMotion(
  settings: MotionPreviewSettings,
  duration: number,
  placement: Affine,
): RootMotionDefinition {
  if (!settings.positionKeys.length || !validPreviewPositionKeys(settings.positionKeys))
    throw new Error('Add a valid preview trajectory before copying.');
  const trajectory = { ...settings, enabled: true };
  const initial = evaluatePreviewDisplacement(trajectory, 0);
  if (initial.x !== 0 || initial.y !== 0)
    throw new Error(
      'Copy requires a trajectory starting at X 0, Y 0. Root motion measures travel from its first sample.',
    );
  const times = [
    0,
    ...settings.positionKeys.filter((key) => key.time > 0 && key.time < duration).map((key) => key.time),
    duration,
  ];
  return {
    translationKeys: times.map((time) => {
      const point = worldToLocal(
        evaluatePreviewDisplacement(trajectory, time),
        rootMotionMatrix(placement, { x: 0, y: 0 }),
      );
      if (!point) throw new Error('Cannot copy through a noninvertible character placement.');
      return {
        time,
        ...point,
        ...(settings.interpolation === 'stepped'
          ? { curves: { x: { mode: 'stepped' as const }, y: { mode: 'stepped' as const } } }
          : {}),
      };
    }),
  };
}
