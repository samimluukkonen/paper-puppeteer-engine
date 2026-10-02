import { afterEach, assert, test, vi } from 'vitest';
import { DemoPresenter } from '../src/demo/DemoPresenter.js';
import { sword } from '../src/demo/demoAnimations.js';
import { demoIK } from '../src/demo/demoIK.js';
import { demoRig } from '../src/demo/demoRig.js';
import { IKDebug } from '../src/engine/ik/IKDebug.js';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetDebug } from '../src/engine/PuppetDebug.js';
import { SlotDebug } from '../src/engine/SlotDebug.js';
import type { Facing } from '../src/engine/types.js';
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
    animations: [sword],
    ik: demoIK,
    x: 380,
    y: 362,
    scale: 1.08,
    autoUpdate: false,
  });
  puppet.setFacing(facing).play('sword');
  return { puppet, presenter: new DemoPresenter(scene, puppet) };
}

test.each(['left', 'right'] as const)('deferred overlays preserve katana corrections facing %s', (facing) => {
  const optimized = fixture(facing);
  const baseline = fixture(facing);
  const options = { handIK: true, footIK: false, upperBody: false };
  // Initialize attachment mode and label placement before measuring corrective solves.
  optimized.presenter.update(options);
  baseline.presenter.update(options);
  const immediateSync = baseline.puppet.syncPose.bind(baseline.puppet);
  baseline.puppet.syncPose = () => immediateSync();
  const sync = vi.spyOn(optimized.puppet, 'syncPose');
  const views = [PuppetDebug, IKDebug, SlotDebug].map((view) => vi.spyOn(view.prototype, 'update'));
  for (let frame = 0; frame < 60; frame += 1) {
    const phase = (frame / 60) * Math.PI * 2;
    const target = { x: 380 + (facing === 'right' ? 1 : -1) * Math.sin(phase) * 250, y: 280 + Math.cos(phase) * 180 };
    for (const view of views) view.mockClear();
    optimized.presenter.handTarget = target;
    optimized.presenter.update(options);
    for (const view of views) assert.equal(view.mock.calls.length, 1, `${view.getMockName()} at frame ${frame}`);
    baseline.presenter.handTarget = target;
    baseline.presenter.update(options);
    for (const bone of demoRig.bones)
      assert.deepEqual(optimized.puppet.getBone(bone.id).pose, baseline.puppet.getBone(bone.id).pose);
    for (const id of ['leftArmIK', 'rightArmIK'])
      assert.equal(optimized.puppet.getIK(id).status, baseline.puppet.getIK(id).status);
  }
  assert.isAbove(sync.mock.calls.length, 60, 'targets exercise correction passes');
  assert.isTrue(sync.mock.calls.every(([options]) => options?.updateDebug === false));
});
