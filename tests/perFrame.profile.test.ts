import { readFileSync } from 'node:fs';
import { assert, test, vi } from 'vitest';
import { DemoPresenter } from '../src/demo/DemoPresenter.js';
import { idle, sword, walk } from '../src/demo/demoAnimations.js';
import { demoIK } from '../src/demo/demoIK.js';
import { demoRenderOrder } from '../src/demo/demoPresentation.js';
import { demoRig } from '../src/demo/demoRig.js';
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

for (const facing of ['left', 'right'] as const) {
  for (const workload of ['walk', 'sword-reachable', 'sword-clamped', 'sword-head-sweep', 'upper-body'] as const) {
    const scene = puppetScene();
    const originalImage = scene.add.image.bind(scene.add);
    scene.add.image = (x, y, texture, frame) => {
      const image = originalImage(x, y, texture, frame);
      const png = readFileSync(new URL(`../public/characters/demo-puppet/images/${texture}.png`, import.meta.url));
      image.width = png.readUInt32BE(16);
      image.height = png.readUInt32BE(20);
      return image;
    };
    const demo = new Puppet(scene, {
      rig: demoRig,
      animations: [idle, walk, sword],
      ik: demoIK,
      x: 380,
      y: 362,
      scale: 1.08,
      autoUpdate: false,
    });
    demo.setFacing(facing).play(workload.startsWith('sword') ? 'sword' : 'walk');
    const presenter = new DemoPresenter(scene, demo);
    const syncPose = demo.syncPose.bind(demo);
    let syncs = 0;
    demo.syncPose = () => {
      syncs += 1;
      syncPose();
    };
    let frames = 0,
      totalSyncs = 0,
      maxSyncs = 0,
      correctionFrames = 0;
    profile(
      `demo ${facing}, ${workload}`,
      () => {
        const phase = ((frames % 240) / 240) * Math.PI * 2;
        const direction = facing === 'right' ? 1 : -1;
        presenter.handTarget =
          workload === 'sword-clamped'
            ? { x: 380 + direction * Math.sin(phase) * 250, y: 280 + Math.cos(phase) * 180 }
            : workload === 'sword-head-sweep'
              ? { x: 380 + direction * Math.sin(phase) * 100, y: 220 + Math.cos(phase) * 50 }
              : { x: 380 + direction * 55, y: 320 };
        syncs = 0;
        demo.preparePose();
        const evaluated = demo.animationPlayer.update(16);
        // Optional comparison recreates the old unconditional order application.
        if (import.meta.env.VITE_PROFILE_UNCACHED === '1')
          demo.setRenderOrder(demoRenderOrder(demo.rig, demo.currentAnimation, facing));
        presenter.feet.advance(16);
        presenter.update(
          { handIK: workload !== 'walk', footIK: true, upperBody: workload === 'upper-body' },
          evaluated,
        );
        totalSyncs += syncs;
        maxSyncs = Math.max(maxSyncs, syncs);
        if (syncs > 1) correctionFrames += 1;
        frames += 1;
      },
      () => {
        if (workload === 'sword-head-sweep' || workload === 'sword-clamped')
          assert.isAbove(correctionFrames, 0, 'profile exercises the katana correction loops');
        return `syncPose/frame: mean ${(totalSyncs / frames).toFixed(2)}, max ${maxSyncs}; corrections on ${((correctionFrames / frames) * 100).toFixed(1)}% of frames (includes warmup)`;
      },
    );
  }
}
