import { composeAffine, localToWorld, transformToAffine, worldToLocal, type Affine, type Point } from './affineMath.js';
import { computeBonePosition } from './boneMath.js';
import {
  createTransform,
  type AttachmentDefinitionBase,
  type MeshAttachmentDefinition,
  type MeshBindPose,
  type RigDefinition,
} from './types.js';
import type { ValidationIssue } from './validation.js';

const emptyAffine = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Effective length normalization can introduce a few ULPs when a validated Rig is captured again. */
function equalRestValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number')
    return (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= Number.EPSILON * 16 * Math.max(1, Math.abs(a), Math.abs(b))
    );
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a))
    return (
      Array.isArray(b) && a.length === b.length && a.every((value: unknown, index) => equalRestValue(value, b[index]))
    );
  if (Array.isArray(b)) return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equalRestValue(left[key], right[key]))
  );
}

/** Capture authored effective rest data only. Never pass live Joint values or an evaluated pose. */
export function createMeshBindPose(rig: RigDefinition, attachment: AttachmentDefinitionBase): MeshBindPose {
  const bones = new Map(rig.bones.map((bone) => [bone.id, bone]));
  return {
    version: 1,
    root: rig.root,
    bones: rig.bones
      .map((bone) => ({
        id: bone.id,
        ...(bone.parent === undefined ? {} : { parent: bone.parent }),
        ...createTransform(bone),
        ...computeBonePosition(bone, bone.parent === undefined ? undefined : bones.get(bone.parent)),
      }))
      .sort(byId),
    slots: (rig.slots ?? []).map((slot) => ({ id: slot.id, bone: slot.bone, ...createTransform(slot) })).sort(byId),
    attachment: createTransform(attachment),
  };
}

/** A changed rest hierarchy/slot/attachment transform requires an explicit future rebind operation. */
export function validateMeshBindPose(mesh: MeshAttachmentDefinition, rig: RigDefinition): ValidationIssue[] {
  const boneIds = new Set(rig.bones.map((bone) => bone.id));
  const influenceIssues: ValidationIssue[] = [];
  mesh.vertices.forEach((vertex, index) => {
    for (const influence of vertex.influences ?? [])
      if (!boneIds.has(influence.boneId))
        influenceIssues.push({
          severity: 'error',
          path: `vertices[${index}].influences`,
          message: `Missing influence bone "${influence.boneId}".`,
        });
  });
  if (influenceIssues.length) return influenceIssues;
  const actual = {
    ...mesh.bindPose,
    bones: [...mesh.bindPose.bones].sort(byId),
    slots: [...mesh.bindPose.slots].sort(byId),
  };
  if (!equalRestValue(actual, createMeshBindPose(rig, mesh)))
    return [
      {
        severity: 'error',
        path: 'bindPose',
        message:
          'Mesh bind pose does not match the authored rig rest configuration. Restore the rest transforms or explicitly recreate/rebind the mesh.',
      },
    ];
  try {
    for (const bone of actual.bones) {
      if (!worldToLocal({ x: 0, y: 0 }, boneBindMatrix(actual, bone.id)))
        throw new Error('Mesh bind bone transform is singular or unsupported.');
    }
    for (const slot of actual.slots) attachmentBindMatrix(mesh, slot.id);
  } catch (error) {
    return [
      {
        severity: 'error',
        path: 'bindPose',
        message: error instanceof Error ? error.message : 'Unsupported mesh bind transform.',
      },
    ];
  }
  return [];
}

export function boneBindMatrix(bind: MeshBindPose, boneId: string): Affine {
  const bones = new Map(bind.bones.map((bone) => [bone.id, bone]));
  const chain = [];
  const seen = new Set<string>();
  let id: string | undefined = boneId;
  while (id !== undefined) {
    if (seen.has(id)) throw new Error('Mesh bind hierarchy contains a cycle.');
    seen.add(id);
    const bone = bones.get(id);
    if (!bone) throw new Error(`Missing mesh bind bone "${id}".`);
    chain.push(bone);
    id = bone.parent;
  }
  let matrix = emptyAffine();
  for (const bone of chain.reverse())
    matrix = composeAffine(transformToAffine(bone, emptyAffine()), matrix, emptyAffine());
  return matrix;
}

function attachmentBindMatrix(mesh: MeshAttachmentDefinition, slotId: string): Affine {
  const slot = mesh.bindPose.slots.find((entry) => entry.id === slotId);
  if (!slot) throw new Error(`Missing mesh bind slot "${slotId}".`);
  const bone = boneBindMatrix(mesh.bindPose, slot.bone);
  const mount = composeAffine(transformToAffine(slot, emptyAffine()), bone, emptyAffine());
  const matrix = composeAffine(transformToAffine(mesh.bindPose.attachment, emptyAffine()), mount, emptyAffine());
  if (!worldToLocal({ x: matrix.tx, y: matrix.ty }, matrix))
    throw new Error('Mesh bind transform is singular or unsupported.');
  return matrix;
}

/** Attachment-local -> Puppet bind space; includes authored slot and bone ancestors, excludes Actor/camera. */
export function meshAttachmentToBindPose(mesh: MeshAttachmentDefinition, slotId: string, point: Point): Point {
  return localToWorld(point, attachmentBindMatrix(mesh, slotId));
}

export function bindPoseToMeshAttachment(
  mesh: MeshAttachmentDefinition,
  slotId: string,
  point: Point,
): Point | undefined {
  return worldToLocal(point, attachmentBindMatrix(mesh, slotId));
}

/** Bone weights reference stable bone/vertex IDs and this inverse authored rest transform. */
export function meshBindPoseToBoneLocal(
  mesh: MeshAttachmentDefinition,
  boneId: string,
  point: Point,
): Point | undefined {
  return worldToLocal(point, boneBindMatrix(mesh.bindPose, boneId));
}
