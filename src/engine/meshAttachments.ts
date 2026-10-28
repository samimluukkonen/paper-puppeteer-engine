import { createMeshBindPose, validateMeshBindPose } from './meshBindPose.js';
import { imagePixelToAttachmentLocal, imagePixelToUV, validateMeshTopology } from './meshGeometry.js';
import { meshAttachmentSchema, rigDefinitionSchema, spriteAttachmentSchema } from './schemas.js';
import type { MeshAttachmentDefinition, RigDefinition, SpriteAttachmentDefinition } from './types.js';
import { checkRigReferences, throwValidationIssue } from './validation.js';

export {
  createMeshBindPose,
  validateMeshBindPose,
  meshAttachmentToBindPose,
  bindPoseToMeshAttachment,
  meshBindPoseToBoneLocal,
} from './meshBindPose.js';

/** Four stable corner IDs and two clockwise triangles. Input remains a rigid attachment; no automatic conversion. */
export function createRectangleMeshAttachment(
  sprite: SpriteAttachmentDefinition,
  imageSize: { width: number; height: number },
  rig: RigDefinition,
  boneId = rig.root,
): MeshAttachmentDefinition {
  checkRigReferences(rigDefinitionSchema.parse(rig), throwValidationIssue);
  spriteAttachmentSchema.strict().parse(sprite);
  if (sprite.frame !== undefined)
    throw new Error('Rectangle meshes require a whole image; atlas frames are unsupported.');
  const { type: _type, frame: _frame, ...fields } = sprite;
  const { width, height } = imageSize;
  const mesh: MeshAttachmentDefinition = {
    ...fields,
    type: 'mesh',
    meshVersion: 1,
    imageSize: { width, height },
    vertices: [
      { id: 'top-left', x: 0, y: 0 },
      { id: 'top-right', x: width, y: 0 },
      { id: 'bottom-right', x: width, y: height },
      { id: 'bottom-left', x: 0, y: height },
    ].map(({ id, x, y }) => ({
      id,
      ...imagePixelToAttachmentLocal({ x, y }, width, height, sprite.originX, sprite.originY),
      ...imagePixelToUV({ x, y }, width, height),
      influences: [{ boneId, weight: 1 }],
    })),
    triangles: [0, 1, 2, 0, 2, 3],
    bindPose: createMeshBindPose(rig, sprite),
  };
  const parsed = meshAttachmentSchema.parse(mesh);
  const issues = [...validateMeshTopology(parsed), ...validateMeshBindPose(parsed, rig)];
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join('\n'));
  return parsed;
}

/** Atomic topology replacement for future subdivision tools; retains bind data and caller-supplied vertex IDs. */
export function replaceMeshGeometry(
  mesh: MeshAttachmentDefinition,
  geometry: Pick<MeshAttachmentDefinition, 'vertices' | 'triangles'>,
  rig: RigDefinition,
): MeshAttachmentDefinition {
  checkRigReferences(rigDefinitionSchema.parse(rig), throwValidationIssue);
  const parsed = meshAttachmentSchema.parse({ ...mesh, vertices: geometry.vertices, triangles: geometry.triangles });
  for (const issue of [...validateMeshTopology(parsed), ...validateMeshBindPose(parsed, rig)])
    throwValidationIssue(issue);
  return parsed;
}
