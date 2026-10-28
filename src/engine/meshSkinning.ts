import { composeAffine, localToWorld, transformToAffine, worldToLocal, type Affine } from './affineMath.js';
import { boneBindMatrix } from './meshBindPose.js';
import type { BoneInfluence, JointTransform, MeshAttachmentDefinition } from './types.js';
import { createTransform } from './types.js';

export const MAX_BONE_INFLUENCES = 4;
const identity = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

/** Explicit authoring utility. Invalid imported weights are rejected, never silently repaired. */
export function normalizeBoneInfluences(influences: readonly BoneInfluence[]): BoneInfluence[] {
  if (
    !influences.length ||
    influences.length > MAX_BONE_INFLUENCES ||
    new Set(influences.map((entry) => entry.boneId)).size !== influences.length ||
    influences.some((entry) => !entry.boneId || !Number.isFinite(entry.weight) || entry.weight < 0)
  )
    throw new Error('Expected one to four unique bones with finite nonnegative influence weights.');
  const maximum = Math.max(...influences.map((entry) => entry.weight));
  if (maximum === 0) throw new Error('Bone influence weights must have a positive total.');
  const total = influences.reduce((sum, entry) => sum + entry.weight / maximum, 0);
  return influences.map((entry) => ({ boneId: entry.boneId, weight: entry.weight / maximum / total }));
}

export interface MeshSkinBinding {
  readonly rigid: boolean;
  readonly localVertices: readonly number[];
  /** Cached inverse-bind points. No live pose or previously deformed geometry is retained. */
  readonly vertices: readonly {
    readonly u: number;
    readonly v: number;
    readonly influences: readonly {
      readonly boneId: string;
      readonly weight: number;
      readonly x: number;
      readonly y: number;
    }[];
  }[];
}

/** Compile A_bind = B_slot_bind * S * A, then cache inverse(B_i_bind) * A_bind * v.
 * S/A may be runtime slot/artwork transforms; bone binds always come from authored rest data.
 */
export function createMeshSkinBinding(
  mesh: MeshAttachmentDefinition,
  slotId: string,
  slotTransform?: Readonly<JointTransform>,
  attachmentTransform?: Readonly<JointTransform>,
): MeshSkinBinding {
  const slot = mesh.bindPose.slots.find((entry) => entry.id === slotId);
  if (!slot) throw new Error(`Missing mesh bind slot "${slotId}".`);
  const matrices = new Map<string, Affine>();
  const bindBone = (id: string): Affine => {
    let matrix = matrices.get(id);
    if (!matrix) {
      matrix = boneBindMatrix(mesh.bindPose, id);
      matrices.set(id, matrix);
    }
    return matrix;
  };
  const mount = composeAffine(transformToAffine(slotTransform ?? slot, identity()), bindBone(slot.bone), identity());
  const attachment = composeAffine(
    transformToAffine(attachmentTransform ?? createTransform(mesh), identity()),
    mount,
    identity(),
  );
  return {
    rigid: mesh.vertices.every(
      (vertex) => !vertex.influences || (vertex.influences.length === 1 && vertex.influences[0]!.boneId === slot.bone),
    ),
    localVertices: mesh.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.u, vertex.v]),
    vertices: mesh.vertices.map((vertex) => {
      const point = localToWorld(vertex, attachment);
      // Rig validation accepts only normalized input, within its rounding tolerance.
      // Normalize the compiled cache too so accepted roundoff cannot shift the bind pose.
      const influences = normalizeBoneInfluences(vertex.influences ?? [{ boneId: slot.bone, weight: 1 }]);
      return {
        u: vertex.u,
        v: vertex.v,
        influences: influences.map((influence) => {
          const local = worldToLocal(point, bindBone(influence.boneId));
          if (!local) throw new Error(`Singular mesh inverse bind for bone "${influence.boneId}".`);
          return { ...influence, ...local };
        }),
      };
    }),
  };
}

/** CPU linear blend skinning into a reusable XYUV buffer in Puppet-local space.
 * Matrices must be the authoritative final FK/IK matrices, excluding Puppet/Actor placement.
 */
export function deformMesh(
  binding: MeshSkinBinding,
  getBoneMatrix: (boneId: string) => Readonly<Affine> | undefined,
  output: number[] = [],
): number[] {
  output.length = binding.vertices.length * 4;
  binding.vertices.forEach((vertex, index) => {
    let x = 0,
      y = 0;
    for (const influence of vertex.influences) {
      const matrix = getBoneMatrix(influence.boneId);
      if (!matrix) throw new Error(`Missing posed mesh bone "${influence.boneId}".`);
      x += influence.weight * (matrix.a * influence.x + matrix.c * influence.y + matrix.tx);
      y += influence.weight * (matrix.b * influence.x + matrix.d * influence.y + matrix.ty);
    }
    output[index * 4] = x;
    output[index * 4 + 1] = y;
    output[index * 4 + 2] = vertex.u;
    output[index * 4 + 3] = vertex.v;
  });
  return output;
}
