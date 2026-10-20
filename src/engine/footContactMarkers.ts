import { type Affine, localToWorld, transformToAffine, type Point } from './affineMath.js';
import { Rig } from './Rig.js';
import { footContactMarkerSchema } from './schemas.js';
import { createTransform, type FootContactMarker, type JointTransform, type RigDefinition } from './types.js';

export type CreateFootContactMarkerOptions = Omit<FootContactMarker, 'localX' | 'localY'> &
  Partial<Pick<FootContactMarker, 'localX' | 'localY'>>;

/** Return a validated authored copy. The caller supplies a stable ID; it is never regenerated.
 * Start at the first child's bind offset, or (0, length) for a leaf, or the joint origin.
 * This is only an editing seed, never an inferred sole or an IK end offset.
 */
export function createFootContactMarker(rig: RigDefinition, options: CreateFootContactMarkerOptions): RigDefinition {
  const values = footContactMarkerSchema.partial({ localX: true, localY: true }).parse(options);
  const validated = new Rig(rig);
  const bone = validated.getBone(values.boneId);
  const child = validated.bones.find((entry) => entry.parent === bone.id);
  const marker = footContactMarkerSchema.parse({
    ...values,
    localX: values.localX ?? child?.x ?? 0,
    localY: values.localY ?? child?.y ?? bone.length ?? 0,
  });
  const candidate = { ...rig, footContactMarkers: [...(rig.footContactMarkers ?? []), marker] };
  new Rig(candidate);
  return candidate;
}

/** Evaluate a bone-local reference using final local joint transforms (after IK).
 * Missing pose entries use normalized bind transforms. This function never runs IK or edits a pose.
 * puppetToWorld is the full outer-container world affine, including facing and Actor/ancestor
 * placement. Omit it for puppet-local coordinates. Camera/screen transforms do not belong here.
 * Missing bones or nonfinite results return undefined, so stale references are safe to query.
 */
export function getFootContactWorldPosition(
  marker: Readonly<FootContactMarker>,
  rig: Rig,
  evaluatedPose: ReadonlyMap<string, Readonly<Partial<JointTransform>>>,
  puppetToWorld?: Readonly<Affine>,
): Point | undefined {
  if (!rig.hasBone(marker.boneId)) return undefined;
  let point: Point = { x: marker.localX, y: marker.localY };
  let id: string | undefined = marker.boneId;
  // Applying local matrices from the attachment up to the root preserves parent shear and reflection.
  while (id !== undefined) {
    const bone = rig.getBone(id);
    const transform = { ...createTransform(bone), ...evaluatedPose.get(id) };
    point = localToWorld(point, transformToAffine(transform, {} as Affine));
    id = bone.parent;
  }
  if (puppetToWorld) point = localToWorld(point, puppetToWorld);
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
}
