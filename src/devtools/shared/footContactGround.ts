import { getFootContactWorldPosition } from '../../engine/core.js';
import type { Point, Rig } from '../../engine/data.js';
import type { Puppet } from '../../engine/runtime.js';

export const DEFAULT_CONTACT_TOLERANCE = 0.5;

/** World Y grows downward: positive is below the guide, negative is above it. */
export function contactGroundDistance(point: Point, groundY: number, tolerance = DEFAULT_CONTACT_TOLERANCE) {
  const distance = point.y - groundY;
  return {
    distance,
    relation: Math.abs(distance) <= tolerance ? 'on ground' : distance < 0 ? 'above ground' : 'below ground',
  } as const;
}

/** Read the final synchronized pose, after FK, pose overrides and all IK passes. */
export function evaluatedFootContacts(puppet: Pick<Puppet, 'rig' | 'getBone' | 'container'>, rig: Rig = puppet.rig) {
  if (!rig.footContactMarkers?.length) return [];
  const pose = new Map(rig.bones.map(({ id }) => [id, puppet.getBone(id).pose]));
  const matrix = puppet.container.getWorldTransformMatrix();
  return (rig.footContactMarkers ?? []).flatMap((marker) => {
    const world = getFootContactWorldPosition(marker, rig, pose, matrix);
    return world ? [{ id: marker.id, name: marker.name, world }] : [];
  });
}
