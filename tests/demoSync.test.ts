import { afterEach, assert, test, vi } from 'vitest';
import { DemoPresenter } from '../src/demo/DemoPresenter.js';
import { demoIK } from '../src/demo/demoIK.js';
import { IKDebug } from '../src/engine/ik/IKDebug.js';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetDebug } from '../src/engine/PuppetDebug.js';
import { SlotDebug } from '../src/engine/SlotDebug.js';
import type { Facing } from '../src/engine/types.js';
import { demoRig, guardUpperBody, sword } from './helpers/demoCharacter.js';
import { demoPuppetScene } from './helpers/demoPuppetScene.js';

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
afterEach(() => vi.restoreAllMocks());

function fixture(facing: Facing) {
  const scene = demoPuppetScene();
  const puppet = new Puppet(scene, {
    rig: demoRig,
    animations: [sword, guardUpperBody],
    ik: demoIK,
    x: 380,
    y: 362,
    scale: 1.08,
    autoUpdate: false,
  });
  puppet.setFacing(facing).play('sword');
  return { puppet, presenter: new DemoPresenter(scene, puppet) };
}

test.each([
  ['left', false],
  ['right', false],
  ['left', true],
  ['right', true],
] as const)('IK-only corrections preserve katana poses facing %s with upper-body layer %s', (facing, upperBody) => {
  const optimized = fixture(facing);
  const baseline = fixture(facing);
  const options = { handIK: true, footIK: false, upperBody };
  if (upperBody)
    for (const { puppet } of [optimized, baseline])
      puppet
        .setLayerMask('upper', ['torso', 'leftUpperArm', 'rightForearm'])
        .play('guardUpperBody', { layer: 'upper', fadeDuration: 250 });
  // Initialize attachment mode and label placement before measuring corrective solves.
  optimized.presenter.update(options);
  baseline.presenter.update(options);
  const immediateSync = baseline.puppet.syncPose.bind(baseline.puppet);
  baseline.puppet.syncPose = () => immediateSync();
  baseline.puppet.syncIK = () => immediateSync();
  const sync = vi.spyOn(optimized.puppet, 'syncPose');
  const corrections = vi.spyOn(optimized.puppet, 'syncIK');
  const views = [PuppetDebug, IKDebug, SlotDebug].map((view) => vi.spyOn(view.prototype, 'update'));
  for (let frame = 0; frame < 60; frame += 1) {
    const phase = (frame / 60) * Math.PI * 2;
    const target = { x: 380 + (facing === 'right' ? 1 : -1) * Math.sin(phase) * 250, y: 280 + Math.cos(phase) * 180 };
    for (const view of views) view.mockClear();
    for (const { puppet } of [optimized, baseline]) {
      puppet.preparePose();
      puppet.animationPlayer.update(16);
    }
    optimized.presenter.handTarget = target;
    optimized.presenter.update(options, true);
    for (const view of views) assert.equal(view.mock.calls.length, 1, `${view.getMockName()} at frame ${frame}`);
    baseline.presenter.handTarget = target;
    baseline.presenter.update(options, true);
    for (const bone of demoRig.bones)
      assert.deepEqual(optimized.puppet.getBone(bone.id).pose, baseline.puppet.getBone(bone.id).pose);
    for (const id of ['leftArmIK', 'rightArmIK'])
      assert.equal(optimized.puppet.getIK(id).status, baseline.puppet.getIK(id).status);
  }
  assert.equal(sync.mock.calls.length, 60, 'one full synchronization per presentation frame');
  assert.isAbove(corrections.mock.calls.length, 0, 'targets exercise correction passes');
  assert.isTrue(sync.mock.calls.every(([options]) => options?.updateDebug === false));
  assert.isTrue(corrections.mock.calls.every(([options]) => options?.updateDebug === false));
});
