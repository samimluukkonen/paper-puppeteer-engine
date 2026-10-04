import { afterEach, assert, test, vi } from 'vitest';
import { DemoPresenter } from '../src/demo/DemoPresenter.js';
import { demoIK } from '../src/demo/demoIK.js';
import { IKDebug } from '../src/engine/ik/IKDebug.js';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetDebug } from '../src/engine/PuppetDebug.js';
import { SlotDebug } from '../src/engine/SlotDebug.js';
import type { Facing } from '../src/engine/types.js';
import { demoRig, guardUpperBody, idle, sword, walk } from './helpers/demoCharacter.js';
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
    skin: 'default',
    animations: [sword, guardUpperBody, idle, walk],
    ik: demoIK,
    x: 380,
    y: 362,
    scale: 1.08,
    autoUpdate: false,
  });
  puppet.setFacing(facing).play('sword');
  return { puppet, presenter: new DemoPresenter(scene, puppet) };
}

test.each(['left', 'right'] as const)('interrupted crossfades preserve the visible arm pose facing %s', (facing) => {
  const { puppet, presenter } = fixture(facing);
  presenter.katana.enabled = false;
  const options = { handIK: false, footIK: false, upperBody: false };
  puppet.play('idle');
  presenter.update(options);
  const fade = (name: string): void => {
    presenter.captureCrossfadeSource();
    puppet.play(name, { fadeDuration: 300 });
    presenter.update(options);
  };
  fade('walk');
  for (const name of ['idle', 'walk', 'idle']) {
    puppet.animationPlayer.update(
      150,
      () => puppet.preparePose(),
      () => presenter.update(options, true),
    );
    const before = ['leftUpperArm', 'rightUpperArm'].map((id) => puppet.getBone(id).pose.rotation);
    fade(name);
    for (const [index, id] of ['leftUpperArm', 'rightUpperArm'].entries())
      assert.approximately(puppet.getBone(id).pose.rotation, before[index]!, 1e-12);
    presenter.update(options);
    for (const [index, id] of ['leftUpperArm', 'rightUpperArm'].entries())
      assert.approximately(puppet.getBone(id).pose.rotation, before[index]!, 1e-12);
  }
  puppet.animationPlayer.update(
    300,
    () => puppet.preparePose(),
    () => presenter.update(options, true),
  );
  const completed = puppet.getBone('leftUpperArm').pose.rotation;
  presenter.update(options);
  assert.approximately(puppet.getBone('leftUpperArm').pose.rotation, completed, 1e-12);
});

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

test.each(['left', 'right'] as const)(
  'grip corrections reuse body geometry within a frame and refresh it facing %s',
  (facing) => {
    const { puppet, presenter } = fixture(facing);
    const corrections = vi.spyOn(puppet, 'syncIK');
    let maximumPasses = 0;
    for (let frame = 0; frame < 30; frame += 1) {
      if (frame === 10) puppet.setSkin('alternate');
      if (frame === 20) puppet.setSkin('default');
      puppet.preparePose();
      puppet.animationPlayer.update(16);
      puppet.getBone('head').pose.rotation += Math.sin(frame) * 0.1;
      puppet.container.setPosition(380 + frame, 362);
      const matrices = ['head', 'torso', 'pelvis'].map((id) =>
        vi.spyOn(puppet.getSlotImage(`${id}Visual`)!, 'getWorldTransformMatrix'),
      );
      const phase = (frame / 30) * Math.PI * 2;
      presenter.handTarget = {
        x: 380 + (facing === 'right' ? 1 : -1) * Math.sin(phase) * 250,
        y: 280 + Math.cos(phase) * 180,
      };
      corrections.mockClear();
      presenter.update({ handIK: true, footIK: false, upperBody: false }, true);
      maximumPasses = Math.max(maximumPasses, corrections.mock.calls.length);
      assert.equal(matrices[0]!.mock.calls.length, 1, 'head geometry reflects this frame');
      for (const matrix of matrices) {
        assert.isAtMost(matrix.mock.calls.length, 1, 'body transforms are independent of the correction count');
        matrix.mockRestore();
      }
    }
    assert.isAbove(maximumPasses, 1, 'the sweep exercises repeated correction passes');
  },
);
