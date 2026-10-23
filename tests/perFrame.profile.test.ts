import { test, vi } from 'vitest';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Vector2: class {
        constructor(
          public x: number,
          public y: number,
        ) {}
      },
    },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

// Run with VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts --reporter=verbose.
// Warmed medians measure CPU evaluation with a minimal scene, excluding browser/GPU costs.
function profile(name: string, frame: () => void, report?: () => string) {
  test.skipIf(import.meta.env.VITE_PROFILE !== '1')(name, { timeout: 30000 }, () => {
    for (let index = 0; index < 1000; index += 1) frame();
    const samples: number[] = [];
    for (let batch = 0; batch < 7; batch += 1) {
      const start = performance.now();
      for (let index = 0; index < 2000; index += 1) frame();
      samples.push(((performance.now() - start) * 1000) / 2000);
    }
    samples.sort((a, b) => a - b);
    console.log(`${name}: ${samples[3]!.toFixed(2)} us/frame (median of 7 batches)`);
    if (report) console.log(report());
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
function player(layers: number, keyCount = 2) {
  // Dense clips represent several seconds of authoring at 30 keys/second.
  const duration = keyCount === 2 ? 1000 : ((keyCount - 1) * 1000) / 30;
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const result = new AnimationPlayer(rig, joints);
  for (let layer = 0; layer < layers; layer += 1) {
    const tracks = Object.fromEntries(
      rig.bones.slice(1).map((bone) => [
        bone.id,
        Array.from({ length: keyCount }, (_, index) => {
          const progress = index / (keyCount - 1);
          return { time: progress * duration, rotation: layer * 0.2 + (1 - layer * 0.2) * progress, x: 10 * progress };
        }),
      ]),
    );
    result.addAnimation({ name: `clip${layer}`, duration, loop: true, tracks });
    result.play(`clip${layer}`, { layer: layer === 0 ? 'base' : `layer${layer}`, fadeDuration: layer ? 1e9 : 0 });
  }
  return result;
}
const base = player(1),
  layered = player(3);
profile('32 tracked bones, base animation', () => base.update(16));
profile('32 tracked bones, three layers with fades', () => layered.update(16));

const ikRig = new Rig({
  root: 'root',
  bones: [
    { id: 'root' },
    ...Array.from({ length: 8 }, (_, index) => [
      { id: `upper${index}`, parent: 'root' },
      { id: `lower${index}`, parent: `upper${index}`, x: 60 },
      { id: `hand${index}`, parent: `lower${index}`, x: 50 },
    ]).flat(),
  ],
  ik: Array.from({ length: 8 }, (_, index) => ({
    name: `arm${index}`,
    rootBone: `upper${index}`,
    middleBone: `lower${index}`,
    endBone: `hand${index}`,
  })),
});
for (const mode of ['smooth', 'stepped'] as const) {
  for (const layers of [1, 3]) {
    const ikPlayer = new AnimationPlayer(
      ikRig,
      new Map(ikRig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)])),
    );
    ikPlayer.setPlaybackMode(mode === 'stepped' ? { mode, fps: 10 } : { mode });
    for (let layer = 0; layer < layers; layer++) {
      ikPlayer.addAnimation({
        name: `reach${layer}`,
        duration: 1000,
        loop: true,
        tracks: {},
        ikTracks: Object.fromEntries(
          ikRig.ik!.map(({ name }) => [
            name,
            [
              { time: 0, x: 40 + layer * 10, y: 70, mix: 0.5 },
              { time: 1000, x: 80, y: 30 + layer * 10, mix: 1 },
            ],
          ]),
        ),
      });
      const name = layer ? `overlay${layer}` : 'base';
      if (layer) {
        ikPlayer.setLayerMask(
          name,
          ikRig.ik!.map(({ rootBone }) => rootBone),
        );
        ikPlayer.setLayerWeight(name, 0.5);
      }
      ikPlayer.play(`reach${layer}`, { layer: name, fadeDuration: layer ? 1e9 : 0 });
    }
    profile(`8 IK channel tracks, ${layers} ${mode} layers`, () => ikPlayer.update(16));
  }
}

for (const keyCount of [128, 512]) {
  const denseBase = player(1, keyCount);
  const denseLayers = player(3, keyCount);
  const denseScrub = player(1, keyCount);
  let scrubFrame = 0;
  profile(`32 tracked bones, dense ${keyCount}-key base animation`, () => denseBase.update(16));
  profile(`32 tracked bones, dense ${keyCount}-key three layers with fades`, () => denseLayers.update(16));
  profile(`32 tracked bones, dense ${keyCount}-key nonsequential scrubbing`, () => {
    // Visit both earlier and later intervals without relying on a playback cursor.
    denseScrub.sample((((scrubFrame++ * 139) % keyCount) * 1000) / 30);
  });
}

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
