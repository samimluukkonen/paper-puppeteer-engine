import { test, vi } from 'vitest';
import { boneBindMatrix } from '../src/engine/meshBindPose.js';
import { createMeshSkinBinding, deformMesh } from '../src/engine/meshSkinning.js';
import { Puppet } from '../src/engine/Puppet.js';
import { productionMesh } from './helpers/productionMesh.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

// Local CPU diagnostic with affine renderer doubles. Native Phaser rendering is measured separately.
for (const side of [2, 12, 32])
  for (const count of [1, 8]) {
    test.skipIf(import.meta.env.VITE_PROFILE !== '1')(
      `mesh profile: ${side * side} vertices × ${count} mixed instances`,
      { timeout: 30000 },
      () => {
        const { rig, mesh } = productionMesh(side);
        const matrices = new Map(mesh.bindPose.bones.map((bone) => [bone.id, boneBindMatrix(mesh.bindPose, bone.id)]));
        const binding = createMeshSkinBinding(mesh, 'cloth');
        const buffer: number[] = [];
        const actors = Array.from({ length: count }, () =>
          new Puppet(puppetScene(), {
            rig,
            autoUpdate: false,
            skin: 'default',
            animations: [
              {
                name: 'attack',
                loop: true,
                duration: 1000,
                tracks: {
                  lower: [
                    { time: 0, rotation: 0 },
                    { time: 1000, rotation: 1 },
                  ],
                },
              },
            ],
          }).play('attack'),
        );
        const measure = (operation: () => void) => {
          for (let i = 0; i < 100; i++) operation();
          const samples = [];
          for (let batch = 0; batch < 5; batch++) {
            const start = performance.now();
            for (let i = 0; i < 200; i++) operation();
            samples.push((performance.now() - start) / 200);
          }
          return samples.sort((a, b) => a - b)[2]!.toFixed(4);
        };
        let frame = 0;
        try {
          const vertexMs = measure(() => {
            for (let i = 0; i < count; i++) deformMesh(binding, (id) => matrices.get(id), buffer);
          });
          const seekMs = measure(() => {
            frame = (frame + 17) % 1000;
            for (const actor of actors) actor.sampleAnimation(frame);
          });
          const playbackMs = measure(() => {
            for (const actor of actors) actor.update(16);
          });
          console.log(
            JSON.stringify({
              vertices: mesh.vertices.length,
              triangles: mesh.triangles.length / 3,
              instances: count,
              vertexMs,
              seekIKSkinningMs: seekMs,
              playbackIKSkinningMs: playbackMs,
              xyuvBytes: mesh.vertices.length * 4 * 8 * count,
            }),
          );
        } finally {
          for (const actor of actors) actor.destroy();
        }
      },
    );
  }
