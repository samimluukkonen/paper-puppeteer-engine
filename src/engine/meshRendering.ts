import type Phaser from 'phaser';
import type { MeshAttachmentDefinition } from './types.js';

/** Phaser 4's native 2D triangle adapter. Textures remain borrowed from the host. */
export function createTexturedMesh(
  scene: Phaser.Scene,
  mesh: MeshAttachmentDefinition,
  texture = mesh.texture,
): Phaser.GameObjects.Mesh2D {
  const indices: number[] = [];
  for (let i = 0; i < mesh.triangles.length; i += 3) indices.push(...mesh.triangles.slice(i, i + 3), 0);
  const object = scene.add.mesh2d(
    mesh.x ?? 0,
    mesh.y ?? 0,
    texture,
    mesh.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.u, vertex.v]),
    indices,
  );
  try {
    object
      .setOrigin(0, 0)
      .setRotation(mesh.rotation ?? 0)
      .setScale(mesh.scaleX ?? 1, mesh.scaleY ?? 1);
    object.renderAsTriangles = true;
    return object;
  } catch (error) {
    object.destroy();
    throw error;
  }
}
