import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { DemoPoseAuthoring } from '../src/demo/DemoPoseAuthoring.js';
import { DemoPresenter } from '../src/demo/DemoPresenter.js';
import { demoIK } from '../src/demo/demoIK.js';
import { demoAuthoringLayout } from '../src/demo/demoPresentation.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../src/engine/Joint.js';
import type { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import type { Facing } from '../src/engine/types.js';
import { demoRig, idle, walk } from './helpers/demoCharacter.js';

function container() {
  return {
    x: 380,
    y: 362,
    scaleX: 1.08,
    scaleY: 1.08,
    rotation: 0,
    parentContainer: undefined as Phaser.GameObjects.Container | undefined,
    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    },
    setRotation(rotation: number) {
      this.rotation = rotation;
      return this;
    },
    setName: vi.fn().mockReturnThis(),
    setVisible: vi.fn().mockReturnThis(),
    add: vi.fn().mockReturnThis(),
    getWorldTransformMatrix() {
      return {
        a: this.scaleX * Math.cos(this.rotation),
        b: this.scaleX * Math.sin(this.rotation),
        c: -this.scaleY * Math.sin(this.rotation),
        d: this.scaleY * Math.cos(this.rotation),
        transformPoint: (x: number, y: number) => ({ x: this.x + x, y: this.y + y }),
      };
    },
  };
}

function fixture(walkClip = walk) {
  const display = {
    setDepth: vi.fn().mockReturnThis(),
    setVisible: vi.fn().mockReturnThis(),
    setText: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    lineStyle: vi.fn().mockReturnThis(),
    strokeCircle: vi.fn().mockReturnThis(),
    lineBetween: vi.fn().mockReturnThis(),
    fillStyle: vi.fn().mockReturnThis(),
    fillRoundedRect: vi.fn().mockReturnThis(),
    fillTriangle: vi.fn().mockReturnThis(),
    fillCircle: vi.fn().mockReturnThis(),
  };
  const scene = {
    scale: { width: 760, height: 640 },
    add: { graphics: () => display, text: () => display, container },
  } as unknown as Phaser.Scene;
  const rig = new Rig(demoRig);
  const bones = new Map(
    rig.bones.map((bone) => [
      bone.id,
      Object.assign(new Joint(bone.id, bone), {
        getWorldPosition: () => ({ x: 380, y: 362 }),
        container: container(),
      }),
    ]),
  );
  const player = new AnimationPlayer(rig, bones);
  player.addAnimation(walkClip);
  player.addAnimation(idle);
  player.play('walk');
  const constraints = new Map(
    demoIK.map((definition) => [definition.name, new TwoBoneIKConstraint(definition, rig, bones)]),
  );
  const slots = new Map<string, string>();
  let renderOrder = rig.renderOrder;
  const puppet = {
    rig,
    facingDirection: 'right' as Facing,
    currentAnimation: 'walk',
    isPlaying: true,
    animationPlayer: player,
    container: container(),
    getBone: (id: string) => bones.get(id)!,
    getIK: (id: string) => constraints.get(id)!,
    preparePose: vi.fn(),
    syncPose: vi.fn(),
    refreshDebugViews: vi.fn(),
    setDebugLabelSide: vi.fn(),
    getRenderOrder: () => renderOrder,
    setRenderOrder: vi.fn((order: readonly string[]) => {
      renderOrder = order;
      return puppet;
    }),
    setFacing(direction: Facing) {
      this.facingDirection = direction;
      this.container.scaleX = direction === 'right' ? 1.08 : -1.08;
      return this;
    },
    resetToBindPose() {
      for (const bone of bones.values()) bone.reset();
      for (const constraint of constraints.values()) constraint.enabled = false;
      return this;
    },
    getSlotImage: vi.fn().mockReturnValue(undefined),
    setAttachment: vi.fn((id: string, attachment: string) => slots.set(id, attachment)),
    clearAttachment: vi.fn((id: string) => slots.delete(id)),
    attach: vi.fn(),
    detach: vi.fn(),
  };
  const presenter = new DemoPresenter(scene, puppet as unknown as Puppet);
  return { scene, puppet, presenter, bones, constraints, slots, display };
}

test('foot planting uses the loaded walk duration instead of a fixed demo duration', () => {
  const { presenter, puppet } = fixture({ ...walk, duration: 2000 });
  puppet.animationPlayer.update(1000);
  const frame = presenter.feet.update(true);
  assert.equal(puppet.animationPlayer.duration, 2000);
  assert.approximately(frame.walkFeet!.left.mix, 0.5, 1e-12);
});

test.each([
  [0, 1],
  [0.5, 1],
  [2, 1],
  [1, 0],
  [1, 0.5],
  [1, 2],
  [0.5, 2],
])('body sway and foot contacts follow global speed %s and clip speed %s', (speed, clipSpeed) => {
  const actual = fixture();
  const reference = fixture();
  const player = actual.puppet.animationPlayer;
  player.play('walk', { speed: clipSpeed });
  player.setSpeed(speed);
  assert.equal(player.currentAnimationSpeed, clipSpeed);
  for (let frame = 0; frame < 5; frame += 1) {
    actual.presenter.feet.advance(125);
    player.update(125);
    const actualFeet = actual.presenter.feet.update(true);
    const elapsed = 125 * speed * clipSpeed;
    reference.presenter.feet.advance(elapsed);
    reference.puppet.animationPlayer.update(elapsed);
    const referenceFeet = reference.presenter.feet.update(true);
    assert.equal(player.elapsedTime, reference.puppet.animationPlayer.elapsedTime);
    assert.equal(actual.puppet.container.x, reference.puppet.container.x);
    assert.equal(actual.puppet.container.y, reference.puppet.container.y);
    assert.deepEqual(actualFeet, referenceFeet);
  }
});

test('advancing presentation evaluates once while paused and stopped frames restore the held pose', () => {
  const { presenter, puppet } = fixture();
  const player = puppet.animationPlayer;
  const evaluate = vi.spyOn(player, 'applyCurrentPose');
  const options = { handIK: false, footIK: false, upperBody: false };
  const frame = () => {
    evaluate.mockClear();
    const evaluated = player.update(50);
    presenter.update(options, evaluated);
    assert.equal(evaluate.mock.calls.length, 1);
    return evaluated;
  };
  assert.isTrue(frame());
  const authored = puppet.getBone('leftUpperArm').pose.rotation;
  player.pause();
  puppet.getBone('leftUpperArm').pose.rotation = 99;
  assert.isFalse(frame());
  assert.equal(puppet.getBone('leftUpperArm').pose.rotation, authored);
  assert.isFalse(frame());
  player.resume();
  assert.isTrue(frame());
  player.stop();
  assert.isFalse(frame());
});

test('presentation reuses render order until facing, order, or animation layout changes', () => {
  const { presenter, puppet } = fixture();
  const options = { handIK: false, footIK: false, upperBody: false };
  presenter.update(options);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 1);
  presenter.update(options);
  puppet.currentAnimation = 'idle';
  presenter.update(options);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 1, 'idle and walk share the same order');
  puppet.setFacing('left');
  presenter.update(options);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 2);
  puppet.currentAnimation = 'custom';
  presenter.update(options);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 3);
  presenter.update(options);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 3);
  puppet.setRenderOrder([...puppet.getRenderOrder()].reverse());
  presenter.update(options);
  assert.deepEqual(puppet.getRenderOrder(), puppet.rig.renderOrder);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 5, 'restores changes made outside the presenter');
});

for (const facing of ['left', 'right'] as const) {
  test(`presentation facing ${facing} samples before foot planting and does not accumulate arm rotations`, () => {
    const { presenter, puppet, constraints } = fixture();
    puppet.setFacing(facing);
    puppet.currentAnimation = 'idle';
    puppet.animationPlayer.play('idle');
    presenter.update({ handIK: false, footIK: false, upperBody: false });
    const armRotation = puppet.getBone('leftUpperArm').pose.rotation;
    presenter.update({ handIK: false, footIK: false, upperBody: false });
    assert.strictEqual(puppet.getBone('leftUpperArm').pose.rotation, armRotation);

    puppet.currentAnimation = 'walk';
    puppet.animationPlayer.play('walk');
    puppet.animationPlayer.sample(0);
    presenter.update({ handIK: false, footIK: true, upperBody: false });
    const leg = constraints.get('leftLegIK')!;
    assert.isTrue(leg.enabled);
    assert.strictEqual(leg.mix, 1);
    const thigh = puppet.getBone('leftThigh').pose;
    const shin = puppet.getBone('leftLowerLeg').pose;
    const foot = puppet.getBone('leftFoot').pose;
    const expectedY = Math.min(
      362 +
        1.08 *
          (puppet.getBone('pelvis').pose.y +
            thigh.y +
            shin.y * Math.cos(thigh.rotation) +
            foot.y * Math.cos(thigh.rotation + shin.rotation)),
      517,
    );
    assert.approximately(leg.target!.y, expectedY, 1e-8);
    const expectedX =
      380 +
      puppet.container.scaleX *
        (puppet.getBone('pelvis').pose.x +
          thigh.x -
          shin.y * Math.sin(thigh.rotation) -
          foot.y * Math.sin(thigh.rotation + shin.rotation));
    assert.approximately(leg.target!.x, expectedX, 1e-8);

    // A solved pose must not become the source of the next frame's target.
    thigh.rotation = 2;
    presenter.update({ handIK: false, footIK: true, upperBody: false });
    assert.approximately(leg.target!.x, expectedX, 1e-8);
    presenter.update({ handIK: false, footIK: false, upperBody: false });
    assert.isFalse(leg.enabled);
    assert.strictEqual(leg.mix, 1);
  });

  test(`pose authoring facing ${facing} preserves edits when switching facing and disables edits after exit`, () => {
    const { scene, puppet } = fixture();
    puppet.setFacing(facing);
    const authoring = new DemoPoseAuthoring(scene, puppet as unknown as Puppet);
    authoring.enter();
    const selectedIndex = puppet.rig.bones.findIndex((bone) => bone.id === 'leftUpperArm');
    authoring.selectBone(selectedIndex);
    authoring.adjustSelected('x', 4);
    authoring.adjustSelected('rotation', 0.2);
    const before = { ...puppet.getBone('leftUpperArm').pose };
    const opposite = facing === 'left' ? 'right' : 'left';
    authoring.face(opposite);
    const layout = demoAuthoringLayout(puppet.rig, opposite);
    assert.approximately(puppet.getBone('leftUpperArm').pose.x, layout.positions.leftUpperArm + 4, 1e-8);
    assert.approximately(puppet.getBone('leftUpperArm').pose.rotation, layout.rotations.leftUpperArm + 0.2, 1e-8);
    authoring.face(facing);
    assert.approximately(puppet.getBone('leftUpperArm').pose.x, before.x, 1e-8);
    assert.approximately(puppet.getBone('leftUpperArm').pose.rotation, before.rotation, 1e-8);
    authoring.exit();
    authoring.adjustSelected('x', 99);
    assert.strictEqual(puppet.getBone('leftUpperArm').pose.x, before.x);
  });
}

test('katana switches between slot and grip prop, restores skin overrides, and swaps arm priorities with facing', () => {
  const { presenter, puppet, slots, constraints } = fixture();
  const katana = presenter.katana;
  katana.syncMode(false);
  assert.strictEqual(slots.get('rightHandItem'), 'katana');
  slots.clear();
  katana.syncVisualOverride();
  assert.strictEqual(slots.get('rightHandItem'), 'katana');

  puppet.currentAnimation = 'sword';
  katana.syncMode(false);
  assert.isFalse(slots.has('rightHandItem'));
  assert.strictEqual(puppet.attach.mock.lastCall![0], 'rightHand');
  katana.configureArms(presenter.handTarget, true, false);
  const left = constraints.get('leftArmIK')!;
  const right = constraints.get('rightArmIK')!;
  assert.strictEqual(right.priority, 0);
  assert.strictEqual(left.priority, 1);
  assert.deepEqual(left.endOffset, { x: 0, y: 15 });
  assert.deepEqual(right.target, presenter.handTarget);

  puppet.setFacing('left');
  katana.resetRearPalm('left');
  katana.reattach();
  katana.configureArms(presenter.handTarget, true, false);
  assert.strictEqual(puppet.attach.mock.lastCall![0], 'leftHand');
  assert.strictEqual(left.priority, 0);
  assert.strictEqual(right.priority, 1);
  assert.deepEqual(left.endOffset, { x: 0, y: 0 });
  assert.deepEqual(right.endOffset, { x: 0, y: 15 });

  katana.enabled = false;
  katana.syncMode(false);
  katana.configureArms(presenter.handTarget, true, false);
  assert.strictEqual(puppet.detach.mock.calls.length, 1);
  assert.isFalse(right.enabled);
  assert.isUndefined(katana.getSecondaryTarget());
  katana.enabled = true;
  puppet.currentAnimation = 'idle';
  katana.syncMode(true);
  katana.configureArms(presenter.handTarget, false, true);
  assert.isTrue(left.enabled);
  assert.isTrue(right.enabled);
  katana.syncMode(false);
  assert.strictEqual(slots.get('rightHandItem'), 'katana');
});

test('foot planting sway stops while paused or stopped and idle recenters the puppet', () => {
  const { presenter, puppet } = fixture();
  const feet = presenter.feet;
  feet.advance(300);
  feet.update(true);
  const position = { x: puppet.container.x, y: puppet.container.y };
  puppet.animationPlayer.pause();
  feet.advance(500);
  feet.update(true);
  assert.strictEqual(puppet.container.x, position.x);
  assert.strictEqual(puppet.container.y, position.y);
  puppet.animationPlayer.resume();
  puppet.isPlaying = false;
  feet.advance(500);
  feet.update(true);
  assert.strictEqual(puppet.container.x, position.x);
  puppet.currentAnimation = 'idle';
  assert.isUndefined(feet.update(true).walkFeet);
  assert.strictEqual(puppet.container.x, 380);
  assert.strictEqual(puppet.container.y, 362);
});
