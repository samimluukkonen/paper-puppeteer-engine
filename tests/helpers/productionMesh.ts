import { createRectangleMeshAttachment } from '../../src/engine/meshAttachments.js';
import type { MeshAttachmentDefinition, RigDefinition } from '../../src/engine/types.js';

/** Valid connected grid, from a four-vertex sleeve to the supported 1024-vertex limit. */
export function productionMesh(side: number, id = 'sleeve'): { rig: RigDefinition; mesh: MeshAttachmentDefinition } {
  const rig: RigDefinition = {
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', x: 40 },
      { id: 'tip', parent: 'lower', x: 40 },
    ],
    slots: [
      { id: 'cloth', bone: 'upper' },
      { id: 'rigid', bone: 'root', depth: 2 },
    ],
    ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'tip', target: { x: 65, y: 20 }, mix: 1 }],
  };
  const rectangle = createRectangleMeshAttachment(
    { id, texture: 'paper', originX: 0, originY: 0 },
    { width: 80, height: 40 },
    rig,
    'upper',
  );
  const vertices = Array.from({ length: side * side }, (_, i) => {
    const u = (i % side) / (side - 1),
      v = Math.floor(i / side) / (side - 1);
    return {
      id: `v${i}`,
      x: u * 80,
      y: v * 40,
      u,
      v,
      influences: [
        { boneId: 'upper', weight: 1 - u },
        { boneId: 'lower', weight: u },
      ],
    };
  });
  const triangles: number[] = [];
  for (let y = 0; y < side - 1; y++)
    for (let x = 0; x < side - 1; x++) {
      const a = y * side + x;
      triangles.push(a, a + 1, a + side + 1, a, a + side + 1, a + side);
    }
  const mesh = { ...rectangle, vertices, triangles };
  return {
    rig: {
      ...rig,
      attachments: [mesh, { id: 'rigid', texture: 'paper' }],
      skins: [{ version: 1, name: 'default', slots: { cloth: id, rigid: 'rigid' } }],
    },
    mesh,
  };
}
