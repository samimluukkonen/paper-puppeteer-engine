import { test, vi } from 'vitest';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

// Run with VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts --reporter=verbose.
// Warmed medians measure CPU evaluation with a minimal scene, excluding browser/GPU costs.
function profile(name: string, frame: () => void) {
  test.skipIf(import.meta.env.VITE_PROFILE !== '1')(name, () => {
    for (let index = 0; index < 1000; index += 1) frame();
    const samples: number[] = [];
    for (let batch = 0; batch < 7; batch += 1) {
      const start = performance.now();
      for (let index = 0; index < 2000; index += 1) frame();
      samples.push(((performance.now() - start) * 1000) / 2000);
    }
    samples.sort((a, b) => a - b);
    console.log(`${name}: ${samples[3]!.toFixed(2)} us/frame (median of 7 batches)`);
  });
}

const rig = new Rig({
  root: 'root',
  bones: [
    { id: 'root' },
    ...Array.from({ length: 32 }, (_, index) => ({
      id: `bone${index}`,
      parent: 'root',
      x: index,
      y: 10,
    })),
  ],
});
function player(layers: number) {
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const result = new AnimationPlayer(rig, joints);
  for (let layer = 0; layer < layers; layer += 1) {
    const tracks = Object.fromEntries(
      rig.bones.slice(1).map((bone) => [
        bone.id,
        [
          { time: 0, rotation: layer * 0.2, x: 0 },
          { time: 1000, rotation: 1, x: 10 },
        ],
      ]),
    );
    result.addAnimation({ name: `clip${layer}`, duration: 1000, loop: true, tracks });
    result.play(`clip${layer}`, { layer: layer === 0 ? 'base' : `layer${layer}`, fadeDuration: layer ? 1e9 : 0 });
  }
  return result;
}
const base = player(1),
  layered = player(3);
profile('32 tracked bones, base animation', () => base.update(16));
profile('32 tracked bones, three layers with fades', () => layered.update(16));

const puppet = new Puppet(puppetScene(), {
  autoUpdate: false,
  rig: {
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', y: 60 },
      { id: 'hand', parent: 'lower', y: 50 },
      ...rig.bones.slice(1),
    ],
    slots: [{ id: 'item', bone: 'hand' }],
  },
});
for (let index = 0; index < 12; index += 1)
  puppet.addIK({ name: `inactive${index}`, rootBone: 'upper', middleBone: 'lower', endBone: 'hand', enabled: false });
puppet.addIK({ name: 'active', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', mix: 0.5 }).setTarget(60, 70);
profile('36 bones, one active and 12 inactive IK constraints', () => puppet.update(16));
