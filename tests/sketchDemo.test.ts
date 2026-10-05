import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { DemoKatanaController } from '../src/demo/DemoKatanaController.js';
import { DemoPresenter } from '../src/demo/DemoPresenter.js';
import { sketchProfile } from '../src/demo/demoCharacterProfiles.js';
import { demoIK } from '../src/demo/demoIK.js';
import { Katana, katanaGrips } from '../src/demo/Katana.js';
import { horizontalEdgesAtY } from '../src/demo/katanaArmTarget.js';
import { SketchFacingLayout } from '../src/demo/SketchFacingLayout.js';
import { CharacterDefinition, type CharacterManifest } from '../src/engine/CharacterDefinition.js';
import { Puppet } from '../src/engine/Puppet.js';
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

const folder = new URL('../public/characters/random-paperdoll-sketch/', import.meta.url);
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, folder), 'utf8'));
const manifest = read('character.json') as CharacterManifest;
const files = Object.fromEntries(
  [...Object.values(manifest.skins), ...manifest.animations, ...(manifest.poses ?? [])].map((path) => [
    path,
    read(path),
  ]),
);
const definition = CharacterDefinition.fromData({
  manifest,
  rig: read(manifest.rig),
  skins: files,
  animations: files,
  poses: files,
});

function fixture() {
  const scene = puppetScene();
  const originalImage = scene.add.image.bind(scene.add);
  scene.add.image = (x, y, texture, frame) => {
    const image = originalImage(x, y, texture, frame);
    if (typeof texture !== 'string') throw new Error('Sketch textures must use string keys.');
    const png = readFileSync(new URL(manifest.textures[texture]!, folder));
    image.width = png.readUInt32BE(16);
    image.height = png.readUInt32BE(20);
    return image;
  };
  const puppet = new Puppet(scene, { definition, ik: demoIK, x: 380, y: 362, scale: 1.08, autoUpdate: false });
  return { scene, puppet };
}

test('left-facing sketch layers only the katana hilt behind the right leg in both weapon modes', () => {
  const { scene, puppet } = fixture();
  const presenter = new DemoPresenter(scene, puppet, sketchProfile);
  const weapon = Reflect.get(presenter.katana, 'katana') as Katana;
  const layer = (object: Phaser.GameObjects.Container | Phaser.GameObjects.Image): number => {
    let branch = object.parentContainer!;
    while (branch.parentContainer?.parentContainer !== puppet.container) branch = branch.parentContainer!;
    return branch.depth;
  };
  const aligned = (
    a: Phaser.GameObjects.Container | Phaser.GameObjects.Image,
    b: Phaser.GameObjects.Container | Phaser.GameObjects.Image,
  ): void => {
    for (const point of [
      { x: 0, y: 0 },
      { x: -26, y: 0 },
      { x: 10, y: 10 },
    ]) {
      const first = a.getWorldTransformMatrix().transformPoint(point.x, point.y);
      const second = b.getWorldTransformMatrix().transformPoint(point.x, point.y);
      assert.approximately(first.x, second.x, 1e-7);
      assert.approximately(first.y, second.y, 1e-7);
    }
  };
  for (const animation of ['sword', 'idle', 'walk', 'sword']) {
    presenter.preparePose();
    puppet.play(animation);
    for (const facing of ['right', 'left', 'right', 'left'] as const) {
      presenter.preparePose();
      puppet.setFacing(facing);
      presenter.update({ handIK: true, footIK: true, upperBody: false });
      if (animation === 'sword') {
        aligned(weapon.hilt, weapon.container);
        assert.isUndefined(puppet.getSlotImage('katanaHilt'));
        if (facing === 'right') assert.equal(weapon.hilt.parentContainer, weapon.container);
        else {
          assert.notEqual(weapon.hilt.parentContainer, weapon.container);
          for (const part of ['Thigh', 'LowerLeg', 'Foot']) {
            assert.isBelow(layer(weapon.hilt), layer(puppet.getSlotImage(`right${part}Visual`)!));
          }
          assert.isAbove(layer(weapon.container), layer(puppet.getSlotImage('rightThighVisual')!));
        }
      } else {
        const blade = puppet.getSlotImage('rightHandItem')!;
        const hilt = puppet.getSlotImage('katanaHilt');
        assert.equal(blade.isCropped, facing === 'left');
        if (facing === 'right') assert.isUndefined(hilt);
        else {
          assert.exists(hilt);
          aligned(hilt!, blade);
          for (const part of ['Thigh', 'LowerLeg', 'Foot']) {
            assert.isBelow(layer(hilt!), layer(puppet.getSlotImage(`right${part}Visual`)!));
          }
          assert.isAbove(layer(blade), layer(puppet.getSlotImage('rightThighVisual')!));
        }
      }
    }
    presenter.katana.enabled = false;
    presenter.update({ handIK: false, footIK: false, upperBody: false });
    assert.isUndefined(puppet.getSlotImage('katanaHilt'));
    assert.isUndefined(puppet.getSlotImage('rightHandItem'));
    assert.isFalse(weapon.container.visible);
    assert.equal(weapon.hilt.parentContainer, weapon.container);
    presenter.katana.enabled = true;
  }
});

test.each(['left', 'right'] as const)(
  'sketch planted walk extends for heel-first landing, rolls flat, and pushes off behind the body facing %s',
  (facing) => {
    const { scene, puppet } = fixture();
    const presenter = new DemoPresenter(scene, puppet, sketchProfile);
    puppet.setFacing(facing).play('walk');
    const direction = facing === 'right' ? 1 : -1;
    for (let time = 0; time <= 20000; time += 25) {
      if (time > 0) {
        puppet.preparePose();
        puppet.animationPlayer.update(25);
        presenter.feet.advance(25);
      }
      presenter.update({ handIK: false, footIK: true, upperBody: false });
      for (const side of ['left', 'right'] as const) {
        const leg = puppet.getIK(`${side}LegIK`);
        assert.isTrue(leg.enabled);
        assert.equal(leg.status, 'solved', `${side} at ${time}ms, target ${JSON.stringify(leg.target)}`);
        const hip = puppet.getBone(`${side}Thigh`).getWorldPosition();
        const knee = puppet.getBone(`${side}LowerLeg`).getWorldPosition();
        const ankle = puppet.getBone(`${side}Foot`).getWorldPosition();
        assert.approximately(ankle.x, leg.target!.x, 1e-5);
        assert.approximately(ankle.y, leg.target!.y, 1e-5);
        const angle = Math.acos(
          Math.max(
            -1,
            Math.min(
              1,
              ((knee.x - hip.x) * (ankle.x - knee.x) + (knee.y - hip.y) * (ankle.y - knee.y)) /
                (Math.hypot(knee.x - hip.x, knee.y - hip.y) * Math.hypot(ankle.x - knee.x, ankle.y - knee.y)),
            ),
          ),
        );
        const sourceSide = facing === 'left' ? (side === 'left' ? 'right' : 'left') : side;
        const step = (time / 1000 + (sourceSide === 'right' ? 0.5 : 0)) % 1;
        assert.isBelow(angle, step <= 0.35 ? 0.6 : 1.05, `${side} knee folds too far at ${time}ms`);
        const image = puppet.getSlotImage(`${side}FootVisual`)!;
        const matrix = image.getWorldTransformMatrix();
        const x = -image.originX * image.width;
        const y = -image.originY * image.height;
        const toe = matrix.transformPoint(x, y + image.height);
        const heel = matrix.transformPoint(x + image.width, y + image.height);
        if (step < 0.001) {
          assert.isBelow(angle, 0.14, 'forward leg should be nearly straight at heel strike');
          assert.isBelow(toe.y, heel.y - 7, 'heel should touch before the raised toes');
          assert.approximately(heel.y, scene.scale.height - 115, 1e-5, 'heel should touch the stage floor first');
        }
        if (Math.abs(step - 0.05) < 0.001) {
          assert.isBelow(toe.y, heel.y - 3, 'toes should lower gradually while the heel stays planted');
          assert.approximately(heel.y, scene.scale.height - 115, 1e-5);
        }
        if (step >= 0.1 && step <= 0.35) {
          assert.approximately(toe.y, heel.y, 1e-5, 'sole should be horizontal at contact');
          assert.approximately(toe.y, scene.scale.height - 115, 1e-5, 'sole should touch the stage floor');
        }
        if (Math.abs(step - 0.5) < 0.001) {
          assert.isBelow(heel.y, toe.y - 7, 'heel should rise as the planted leg moves backward');
          assert.approximately(toe.y, scene.scale.height - 115, 1e-5, 'toe stays planted during heel rise');
        }
        if (Math.abs(step - 0.6) < 0.001) {
          assert.isBelow(direction * (ankle.x - hip.x), -55, 'trailing leg should extend behind the body at toe-off');
          assert.approximately(toe.y, scene.scale.height - 115, 1e-5, 'toe remains planted until push-off');
        }
        if (Math.abs(step - 0.75) < 0.001) {
          assert.isBelow(toe.y, heel.y - 5, 'toes should lift during the return step');
          assert.isBelow(heel.y, scene.scale.height - 115 - 3, 'swing foot should clear the floor');
        }
        if (step >= 0.975) {
          assert.isBelow(angle, 0.22, 'knee should extend before the heel lands');
          assert.isBelow(toe.y, heel.y - 7, 'late swing should already prepare for heel-first contact');
        }
        if (time === 0 && sourceSide === 'left') assert.isAbove(direction * (ankle.x - hip.x), 40);
      }
    }
  },
);

test('sketch planted ankle corrections hold while paused and reset for pose editing or unplanted playback', () => {
  const { scene, puppet } = fixture();
  const presenter = new DemoPresenter(scene, puppet, sketchProfile);
  puppet.play('walk');
  puppet.animationPlayer.update(750);
  const options = { handIK: false, footIK: true, upperBody: false };
  presenter.update(options);
  const image = puppet.getSlotImage('leftFootVisual')!;
  const angle = image.parentContainer!.rotation;
  puppet.animationPlayer.pause();
  presenter.update(options);
  assert.approximately(image.parentContainer!.rotation, angle, 1e-8);
  presenter.clearTargets();
  assert.equal(image.parentContainer!.rotation, 0);
  presenter.update(options);
  presenter.update({ ...options, footIK: false });
  assert.equal(image.parentContainer!.rotation, 0);
});

test.each(['left', 'right'] as const)('sketch katana keeps both palms on their grips facing %s', (facing) => {
  const { scene, puppet } = fixture();
  const weapon = new Katana(scene);
  const controller = new DemoKatanaController(puppet, weapon, sketchProfile);
  const layout = new SketchFacingLayout(puppet);
  puppet.setFacing(facing).play('sword');
  const target = { x: 380 + (facing === 'right' ? 80 : -80), y: 315 };
  for (let frame = 0; frame < 40; frame++) {
    puppet.preparePose();
    layout.restoreAuthoredPose();
    puppet.animationPlayer.applyCurrentPose();
    layout.applyPose();
    layout.syncVisuals();
    controller.syncMode(false);
    controller.configureArms(target, true, false);
    controller.setInitialRotation();
    puppet.syncPose();
    controller.solveGrip(target, true, false);
  }
  const hands = [
    ['right', katanaGrips.primary],
    ['left', katanaGrips.secondary],
  ] as const;
  for (const [side, grip] of hands) {
    assert.isTrue(puppet.getIK(`${side}ArmIK`).enabled);
    const palm = puppet.getBone(`${side}Hand`).container.getWorldTransformMatrix().transformPoint(0, 18);
    const expected = weapon.getGripWorldPosition(grip);
    assert.approximately(palm.x, expected.x, 1e-4);
    assert.approximately(palm.y, expected.y, 1e-4);
  }
});

test.each(['left', 'right'] as const)(
  'sketch katana stays at torso height when the cursor moves inward facing %s',
  (facing) => {
    const { scene, puppet } = fixture();
    const presenter = new DemoPresenter(scene, puppet, sketchProfile);
    puppet.setFacing(facing).play('sword');
    presenter.katana.resetRearPalm(facing);
    const torso = puppet.getBone('torso').getWorldPosition();
    const options = { handIK: true, footIK: false, upperBody: false };
    // Returning from a head-height cursor sweep must not trap the hands at an unreachable upper corner.
    for (const y of [100, 160]) {
      for (const offset of [-70, 0, 70]) {
        presenter.handTarget = { x: torso.x + offset, y };
        for (let frame = 0; frame < 60; frame++) presenter.update(options);
      }
    }
    presenter.handTarget = { x: torso.x + (facing === 'right' ? 100 : -100), y: torso.y - 65 };
    for (let frame = 0; frame < 60; frame++) presenter.update(options);
    for (const y of [torso.y - 75, torso.y - 35, torso.y - 5]) {
      presenter.handTarget = { x: torso.x, y };
      for (let frame = 0; frame < 60; frame++) presenter.update(options);
      for (const side of ['left', 'right'] as const) {
        const palm = puppet.getBone(`${side}Hand`).container.getWorldTransformMatrix().transformPoint(0, 18);
        assert.isAtLeast(palm.y, y - 30, `${side} hand should stay near the torso target`);
        if (side === 'left') {
          const expected = presenter.katana.getSecondaryTarget()!;
          assert.approximately(palm.x, expected.x, 1e-4);
          assert.approximately(palm.y, expected.y, 1e-4);
        }
      }
    }
  },
);

test('sketch equipment skins and combat clips resolve without replacing its artist textures', () => {
  const { puppet } = fixture();
  puppet.setSkin('alternate');
  assert.equal(puppet.getAttachment('armorOverlay'), 'torsoArmored');
  assert.equal(puppet.getAttachment('torsoVisual'), 'torsoDefault');
  assert.equal(puppet.getAttachment('headVisual'), 'headDefault');
  puppet.setAttachment('rightHandVisual', 'rightHandGrip').applySkin('helmet-only');
  assert.equal(puppet.getAttachment('headwear'), 'kabuto');
  puppet.play('sword');
  puppet.setLayerMask('upperBody', ['torso', 'leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm']);
  puppet.play('guardUpperBody', { layer: 'upperBody' });
  puppet.applyPose('combat-ready').syncPose();
  puppet.clearPose().clearLayer('upperBody').setSkin('default');
  assert.isUndefined(puppet.getAttachment('armorOverlay'));
  assert.isUndefined(puppet.getAttachment('headwear'));
});

test.each(['idle', 'walk', 'sword'] as const)(
  'sketch %s swaps actual limb chains and cutouts when facing left without drifting while paused',
  (animation) => {
    const { scene, puppet } = fixture();
    const presenter = new DemoPresenter(scene, puppet, sketchProfile);
    puppet.play(animation);
    puppet.animationPlayer.update(250);
    const options = { handIK: false, footIK: false, upperBody: false };
    presenter.update(options);
    puppet.animationPlayer.pause();
    const parts = ['UpperArm', 'Forearm', 'Hand', 'Thigh', 'LowerLeg', 'Foot'];
    const positions = Object.fromEntries(
      parts.flatMap((part) =>
        ['left', 'right'].map((side) => {
          const id = `${side}${part}`;
          return [id, puppet.getBone(id).getWorldPosition()];
        }),
      ),
    );
    const corners = Object.fromEntries(
      parts.flatMap((part) =>
        ['left', 'right'].map((side) => {
          const id = `${side}${part}`;
          const image = puppet.getSlotImage(`${id}Visual`)!;
          const matrix = image.getWorldTransformMatrix();
          return [id, matrix.transformPoint(-image.originX * image.width, -image.originY * image.height)];
        }),
      ),
    );
    for (const facing of ['left', 'right', 'left', 'right', 'left'] as const) {
      presenter.preparePose();
      puppet.setFacing(facing);
      presenter.katana.reattach();
      for (let frame = 0; frame < 5; frame++) presenter.update(options);
      for (const part of parts)
        for (const side of ['left', 'right'] as const) {
          const id = `${side}${part}`;
          const sourceSide = facing === 'left' ? (side === 'left' ? 'right' : 'left') : side;
          const source = `${sourceSide}${part}`;
          const point = puppet.getBone(id).getWorldPosition();
          const expected = positions[source]!;
          assert.approximately(
            point.x,
            facing === 'left' ? scene.scale.width - expected.x : expected.x,
            1e-5,
            `${id} identity`,
          );
          assert.approximately(point.y, expected.y, 1e-5);
          const image = puppet.getSlotImage(`${id}Visual`)!;
          const corner = image
            .getWorldTransformMatrix()
            .transformPoint(-image.originX * image.width, -image.originY * image.height);
          const expectedCorner = corners[source]!;
          assert.approximately(
            corner.x,
            facing === 'left' ? scene.scale.width - expectedCorner.x : expectedCorner.x,
            1e-5,
            `${id} artwork`,
          );
          assert.approximately(corner.y, expectedCorner.y, 1e-5);
        }
      if (animation !== 'sword') {
        assert.exists(puppet.getSlotImage('rightHandItem'));
      }
    }
  },
);

test.each([
  ['left', false],
  ['right', false],
  ['left', true],
  ['right', true],
] as const)('sketch two-handed rear grip clears torso and legs facing %s, walking %s', (facing, walking) => {
  const { scene, puppet } = fixture();
  const presenter = new DemoPresenter(scene, puppet, sketchProfile);
  puppet.setFacing(facing).play(walking ? 'walk' : 'sword');
  if (walking) {
    puppet.setLayerMask('upperBody', [
      'torso',
      'leftUpperArm',
      'leftForearm',
      'leftHand',
      'rightUpperArm',
      'rightForearm',
      'rightHand',
    ]);
    puppet.play('guardUpperBody', { layer: 'upperBody' });
  }
  presenter.katana.resetRearPalm(facing);
  const options = { handIK: true, footIK: walking, upperBody: walking };
  const body = ['torso', 'leftThigh', 'rightThigh', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
  for (const angleDelta of [0, 0.65, -1.3]) {
    presenter.katana.rotate(angleDelta);
    for (const y of [260, 320, 360, 400, 480]) {
      for (const offset of [90, 0, -90]) {
        presenter.handTarget = { x: 380 + (facing === 'right' ? offset : -offset), y };
        for (let frame = 0; frame < 30; frame++) {
          if (walking) {
            puppet.preparePose();
            puppet.animationPlayer.update(16);
            presenter.feet.advance(16);
          }
          presenter.update(options);
          const palm = puppet.getBone('leftHand').container.getWorldTransformMatrix().transformPoint(0, 18);
          for (const id of body) {
            const image = puppet.getSlotImage(`${id}Visual`)!;
            const matrix = image.getWorldTransformMatrix();
            const x = -image.originX * image.width;
            const y = -image.originY * image.height;
            const corners = [
              matrix.transformPoint(x, y),
              matrix.transformPoint(x + image.width, y),
              matrix.transformPoint(x + image.width, y + image.height),
              matrix.transformPoint(x, y + image.height),
            ];
            const edges = horizontalEdgesAtY(corners, palm.y);
            if (!edges) continue;
            const clearance = facing === 'right' ? palm.x - edges.right : edges.left - palm.x;
            assert.isAtLeast(
              clearance,
              -4.02,
              `${id} at cursor ${JSON.stringify(presenter.handTarget)}, frame ${frame}`,
            );
          }
          const grip = presenter.katana.getSecondaryTarget()!;
          assert.approximately(palm.x, grip.x, 1e-4);
          assert.approximately(palm.y, grip.y, 1e-4);
        }
      }
    }
  }
});
