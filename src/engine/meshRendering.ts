import type Phaser from 'phaser';
import type { MeshAttachmentDefinition } from './types.js';

/** Mesh2D's Canvas renderer is a NOOP in Phaser 4.2.1. Fail before allocating character objects. */
export function assertMeshRenderer(scene: Phaser.Scene): void {
  if (scene.sys?.game?.renderer?.type === 1)
    throw new Error('Mesh attachments require a WebGL renderer; Phaser Canvas cannot render Mesh2D.');
}

/** Mesh2D reads raw GL UVs; whole-image authored UVs start at the top left. */
export function syncMeshTextureOrientation(object: Phaser.GameObjects.Image | Phaser.GameObjects.Mesh2D): void {
  if ('flipV' in object) object.flipV = object.texture.source?.[0]?.flipY ?? true;
}

/** Phaser 4's native 2D triangle adapter. Textures remain borrowed from the host. */
export function createTexturedMesh(
  scene: Phaser.Scene,
  mesh: MeshAttachmentDefinition,
  texture = mesh.texture,
): Phaser.GameObjects.Mesh2D {
  assertMeshRenderer(scene);
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
    syncMeshTextureOrientation(object);
    return object;
  } catch (error) {
    object.destroy();
    throw error;
  }
}
