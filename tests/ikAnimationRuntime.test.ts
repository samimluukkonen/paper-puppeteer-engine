import { assert, test, vi } from 'vitest';
import { DemoFootPlanting } from '../src/demo/DemoFootPlanting.js';
import { DemoKatanaController } from '../src/demo/DemoKatanaController.js';
import { Katana } from '../src/demo/Katana.js';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { localToWorld } from '../src/engine/affineMath.js';
import { compileClip, type AnimationClip, type CompiledClip } from '../src/engine/AnimationClip.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { evaluateIKClip } from '../src/engine/ik/AnimationIKPose.js';
import type { IKKeyframe } from '../src/engine/ik/animationKeyframes.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { paperDollIK } from '../src/shared/paperDollIK.js';
import { demoRig, sword, walk } from './helpers/demoCharacter.js';
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

function rig() {
  return new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'upper', parent: 'root', rotation: 0.1 },
      { id: 'lower', parent: 'upper', y: 60, rotation: 0.2 },
      { id: 'hand', parent: 'lower', y: 50 },
      { id: 'other', parent: 'root' },
    ],
    ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', bendDirection: 1 }],
  });
}

function clip(
  name = 'reach',
  keys: readonly IKKeyframe[] = [
    { time: 0, x: 60, y: 60 },
    { time: 500, x: 30, y: 80 },
    { time: 1000, x: -40, y: 70 },
  ],
): AnimationClip {
  return {
    name,
    duration: 1000,
    loop: false,
    tracks: {
      upper: [
        { time: 0, rotation: 0.1 },
        { time: 1000, rotation: 0.5 },
      ],
    },
    ikTracks: { arm: keys },
  };
}

function fixture(clips: readonly AnimationClip[] = [clip()]) {
  const puppet = new Puppet(puppetScene(), { rig: rig(), animations: clips, autoUpdate: false });
  puppet.play(clips[0]!.name);
  return puppet;
}

function hand(puppet: Puppet) {
  const arm = puppet.getIK('arm');
  return localToWorld(arm.endOffset, puppet.getBone('hand').container.getWorldTransformMatrix());
}

function reaches(puppet: Puppet, point: { x: number; y: number }) {
  const expected = localToWorld(point, puppet.container.getWorldTransformMatrix());
  const actual = hand(puppet);
  assert.approximately(actual.x, expected.x, 1e-8);
  assert.approximately(actual.y, expected.y, 1e-8);
  assert.equal(puppet.getIK('arm').status, 'solved');
}

test('authored A/B/C positions and sparse interpolation drive the existing solver without events or clock changes', () => {
  const puppet = fixture();
  const event = vi.fn();
  const complete = vi.fn();
  puppet.onAnimationEvent(event);
  puppet.onAnimationComplete(complete);
  for (const [time, x, y] of [
    [0, 60, 60],
    [250, 45, 70],
    [500, 30, 80],
    [750, -5, 75],
    [1000, -40, 70],
    [0, 60, 60],
  ]) {
    puppet.sampleAnimation(time!);
    reaches(puppet, { x: x!, y: y! });
    assert.equal(puppet.animationPlayer.elapsedTime, 0);
    assert.equal(puppet.getIK('arm').bendDirection, 1);
  }
  assert.equal(event.mock.calls.length, 0);
  assert.equal(complete.mock.calls.length, 0);
  puppet.update(500);
  reaches(puppet, { x: 30, y: 80 });
  puppet.destroy();
});

test('influence keys interpolate solver rotation mixing and zero restores authored control', () => {
  const animated = clip('influence', [
    { time: 0, x: 60, y: 60, mix: 0 },
    { time: 300, mix: 1 },
    { time: 1000, mix: 0 },
  ]);
  const puppet = fixture([animated]);
  const full = fixture([clip('full', [{ time: 0, x: 60, y: 60 }])]);
  for (const time of [0, 150, 300, 650, 1000]) {
    puppet.sampleAnimation(time);
    full.sampleAnimation(time);
    const mix = time <= 300 ? time / 300 : (1000 - time) / 700;
    const authored = 0.1 + (0.4 * time) / 1000;
    assert.approximately(
      puppet.getBone('upper').pose.rotation,
      authored + (full.getBone('upper').pose.rotation - authored) * mix,
      1e-10,
    );
    if (mix === 0) {
      assert.equal(puppet.getIK('arm').status, 'inactive');
      assert.equal(puppet.getBone('lower').pose.rotation, 0.2);
    }
  }
  assert.equal(puppet.getIK('arm').mix, 1, 'evaluation leaves static settings intact');
  puppet.destroy();
  full.destroy();
});

test.each(['left', 'right'] as const)(
  'targets remain puppet-local through %s facing, placement, scale, rotated parents and enclosing transforms',
  (facing) => {
    const puppet = fixture();
    const scene = puppetScene();
    const parent = scene.add.container(90, -120).setRotation(0.3).setScale(1.7, 0.6);
    parent.add(puppet.container);
    puppet.container.setPosition(350, 230).setScale(2).setRotation(-0.2);
    puppet.setFacing(facing);
    puppet.getBone('root').pose.rotation = 0.7;
    puppet.getBone('root').pose.x = 8;
    puppet.getBone('root').pose.y = 3;
    puppet.sampleAnimation(500);
    reaches(puppet, { x: 30, y: 80 });
    puppet.getIK('arm').setEndOffset({ x: 3, y: 8 });
    puppet.syncIK();
    reaches(puppet, { x: 30, y: 80 });
    puppet.destroy();
    parent.destroy();
  },
);

test('sparse x uses the authored endpoint y; mix-only tracks retain static targets', () => {
  const puppet = fixture([{ ...clip(), ikTracks: { arm: [{ time: 0, x: 10 }] } }]);
  const endpointY = 60 * Math.cos(0.1) + 50 * Math.cos(0.3);
  reaches(puppet, { x: 10, y: endpointY });
  puppet.addAnimation(
    clip('mixOnly', [
      { time: 0, mix: 0 },
      { time: 1000, mix: 1 },
    ]),
  );
  puppet.getIK('arm').setTarget(60, 60);
  puppet.play('mixOnly');
  assert.equal(puppet.getIK('arm').status, 'inactive');
  assert.equal(puppet.getBone('upper').pose.rotation, 0.1);
  puppet.sampleAnimation(1000);
  reaches(puppet, { x: 60, y: 60 });
  puppet.destroy();
});

test('manual world positions override animation positions; explicit mix and providers preserve procedural ownership', () => {
  const puppet = fixture([clip('reach', [{ time: 0, x: -20, y: 80, mix: 0 }])]);
  const arm = puppet.getIK('arm');
  arm.setTarget(60, 60);
  puppet.syncIK();
  assert.equal(arm.status, 'inactive', 'animated mix can affect an ordinary runtime target');
  arm.mix = 1;
  puppet.syncIK();
  reaches(puppet, { x: 60, y: 60 });
  arm.clearMixOverride();
  puppet.syncIK();
  assert.equal(arm.status, 'inactive');
  const provider = vi.fn(() => ({ x: 30, y: 80 }));
  arm.setTargetProvider(provider);
  puppet.syncIK();
  reaches(puppet, { x: 30, y: 80 });
  assert.equal(provider.mock.calls.length, 1);
  arm.setTargetProvider(() => undefined);
  puppet.syncIK();
  assert.equal(arm.status, 'inactive', 'a missing mandatory grip never falls back to a generic track');
  arm.target = undefined;
  puppet.syncIK();
  assert.equal(arm.status, 'inactive', 'clearing overrides restores animated zero mix');
  arm.enabled = false;
  puppet.destroy();
});

test('layers blend channels independently, root-bone masks control chains, and clearing layers restores the base', () => {
  const puppet = fixture([clip('base', [{ time: 0, x: 40, y: 70 }]), clip('partial', [{ time: 0, x: 80, mix: 0.5 }])]);
  puppet.setLayerMask('upperBody', ['upper']);
  puppet.setLayerWeight('upperBody', 0.5);
  puppet.play('partial', { layer: 'upperBody' });
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.value, 60);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.y!.value, 70);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.mix!.weight, 0.5);
  puppet.setLayerMask('upperBody', ['hand', 'other']);
  reaches(puppet, { x: 40, y: 70 });
  puppet.setLayerMask('upperBody', ['upper']);
  puppet.setLayerWeight('upperBody', 0);
  reaches(puppet, { x: 40, y: 70 });
  puppet.setLayerWeight('upperBody', 1);
  puppet.clearLayer('upperBody');
  reaches(puppet, { x: 40, y: 70 });
  puppet.destroy();
});

test('crossfades and interrupted crossfades blend targets and influence with the bone fade clocks', () => {
  const puppet = fixture([
    clip('a', [{ time: 0, x: 60, y: 60, mix: 1 }]),
    clip('b', [{ time: 0, x: -20, y: 80, mix: 0.5 }]),
    clip('c', [{ time: 0, x: 0, y: 90, mix: 1 }]),
  ]);
  puppet.play('b', { fadeDuration: 1000 });
  reaches(puppet, { x: 60, y: 60 });
  puppet.update(500);
  const values = puppet.animationPlayer.ikAnimation.get('arm')!;
  assert.equal(values.x!.value, 20);
  assert.equal(values.y!.value, 70);
  assert.equal(values.mix!.value, 0.75);
  const held = { ...puppet.getBone('upper').pose };
  puppet.play('c', { fadeDuration: 1000 });
  assert.deepEqual(puppet.getBone('upper').pose, held, 'interrupted fade starts from the held pose');
  puppet.update(500);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.value, 10);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.y!.value, 80);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.mix!.value, 0.875);
  puppet.update(500);
  reaches(puppet, { x: 0, y: 90 });
  puppet.destroy();
});

test('fading to/from absent target tracks releases ownership and preserves interrupted sparse fades', () => {
  const old = clip('old');
  delete old.ikTracks;
  const puppet = fixture([old, clip('reach')]);
  puppet.play('reach', { fadeDuration: 1000 });
  assert.equal(puppet.animationPlayer.ikAnimation.size, 0);
  puppet.update(500);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.weight, 0.5);
  puppet.play('old', { fadeDuration: 1000 });
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.weight, 0.5);
  puppet.update(500);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.weight, 0.25);
  puppet.update(500);
  assert.equal(puppet.animationPlayer.ikAnimation.size, 0);
  assert.equal(puppet.getIK('arm').status, 'inactive');
  assert.approximately(puppet.getBone('upper').pose.rotation, 0.5, 1e-12);
  puppet.destroy();
});

test('partial overlay fade-in and scrub share base-only sampling semantics', () => {
  const puppet = fixture([clip('base', [{ time: 0, x: 40, y: 70 }]), clip('overlay', [{ time: 0, x: 80 }])]);
  puppet.play('overlay', { layer: 'overlay', fadeDuration: 1000 });
  reaches(puppet, { x: 40, y: 70 });
  puppet.update(500);
  reaches(puppet, { x: 60, y: 70 });
  puppet.sampleAnimation(750);
  reaches(puppet, { x: 40, y: 70 });
  puppet.preparePose();
  puppet.animationPlayer.applyCurrentPose();
  puppet.syncPose();
  reaches(puppet, { x: 60, y: 70 });
  puppet.destroy();
});

test('stepped positions and fade weights hold while rendering continues, with exact nonlooping completion and restart', () => {
  const puppet = fixture([{ ...clip(), duration: 1050, playback: { mode: 'stepped', fps: 10 } }]);
  const renderer = vi.spyOn(puppet.getBone('upper'), 'syncTransform');
  puppet.update(50);
  reaches(puppet, { x: 60, y: 60 });
  puppet.update(49);
  reaches(puppet, { x: 60, y: 60 });
  assert.isAbove(renderer.mock.calls.length, 1);
  puppet.update(1);
  reaches(puppet, { x: 54, y: 64 });
  puppet.sampleAnimation(175, { mode: 'raw' });
  reaches(puppet, { x: 49.5, y: 67 });
  puppet.sampleAnimation(175, { mode: 'playback' });
  reaches(puppet, { x: 54, y: 64 });
  const complete = vi.fn();
  puppet.onAnimationComplete(complete);
  puppet.update(950);
  reaches(puppet, { x: -40, y: 70 });
  assert.isFalse(puppet.isPlaying);
  assert.equal(complete.mock.calls.length, 1);
  puppet.update(100);
  reaches(puppet, { x: -40, y: 70 });
  puppet.restart();
  reaches(puppet, { x: 60, y: 60 });
  puppet.addAnimation({ ...clip('next', [{ time: 0, x: 0, y: 90 }]), playback: { mode: 'stepped', fps: 10 } });
  puppet.play('next', { fadeDuration: 1000 });
  puppet.update(50);
  reaches(puppet, { x: 60, y: 60 });
  puppet.update(50);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.value, 48.6);
  puppet.destroy();
});

test('held stepped IK samples reuse immutable poses and changing frames preserve earlier snapshots', () => {
  const puppet = fixture([{ ...clip(), playback: { mode: 'stepped', fps: 10 } }]);
  const first = puppet.animationPlayer.ikAnimation;
  for (const delta of [20, 20, 59]) {
    puppet.update(delta);
    assert.strictEqual(puppet.animationPlayer.ikAnimation, first);
    reaches(puppet, { x: 60, y: 60 });
  }
  puppet.update(1);
  const second = puppet.animationPlayer.ikAnimation;
  assert.notStrictEqual(second, first);
  assert.equal(first.get('arm')!.x!.value, 60);
  assert.equal(second.get('arm')!.x!.value, 54);
  assert.isTrue(Object.isFrozen(first.get('arm')));
  assert.isTrue(Object.isFrozen(first.get('arm')!.x));
  assert.isFalse('set' in first);
  puppet.sampleAnimation(175, { mode: 'playback' });
  const sampled = puppet.animationPlayer.ikAnimation;
  puppet.sampleAnimation(199, { mode: 'playback' });
  assert.strictEqual(puppet.animationPlayer.ikAnimation, sampled);
  puppet.sampleAnimation(175, { mode: 'raw' });
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.value, 49.5);
  assert.equal(sampled.get('arm')!.x!.value, 54);
  puppet.destroy();
});

test('held layered IK poses invalidate on weight and root-mask changes while retaining sparse channels', () => {
  const animations = [clip('base', [{ time: 0, x: 40, y: 70 }]), clip('overlay', [{ time: 0, x: 80, mix: 0.5 }])].map(
    (animation) => ({ ...animation, playback: { mode: 'stepped' as const, fps: 10 } }),
  );
  const puppet = fixture(animations);
  puppet.setLayerMask('overlay', ['upper']);
  puppet.setLayerWeight('overlay', 0.5);
  puppet.play('overlay', { layer: 'overlay' });
  const first = puppet.animationPlayer.ikAnimation;
  puppet.update(49);
  assert.strictEqual(puppet.animationPlayer.ikAnimation, first);
  puppet.setLayerWeight('overlay', 0.25);
  const weighted = puppet.animationPlayer.ikAnimation;
  assert.notStrictEqual(weighted, first);
  assert.equal(weighted.get('arm')!.x!.value, 50);
  assert.equal(weighted.get('arm')!.y!.value, 70);
  assert.equal(weighted.get('arm')!.mix!.weight, 0.25);
  puppet.animationPlayer.applyCurrentPose();
  assert.strictEqual(puppet.animationPlayer.ikAnimation, weighted);
  puppet.setLayerMask('overlay', ['hand']);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.value, 40);
  puppet.setLayerMask('overlay', ['upper']);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.value, 50);
  assert.equal(first.get('arm')!.x!.value, 60);
  assert.equal(first.get('arm')!.mix!.weight, 0.5);
  puppet.destroy();
});

test('stepped fade caches hold frames and recompute when the fade progresses or is interrupted', () => {
  const puppet = fixture([
    { ...clip('a'), playback: { mode: 'stepped', fps: 10 } },
    { ...clip('b', [{ time: 0, x: 0, y: 90 }]), playback: { mode: 'stepped', fps: 10 } },
    { ...clip('c', [{ time: 0, x: -20, y: 70 }]), playback: { mode: 'stepped', fps: 10 } },
  ]);
  puppet.play('b', { fadeDuration: 1000 });
  const first = puppet.animationPlayer.ikAnimation;
  puppet.update(50);
  assert.strictEqual(puppet.animationPlayer.ikAnimation, first);
  puppet.update(50);
  const blended = puppet.animationPlayer.ikAnimation;
  assert.equal(blended.get('arm')!.x!.value, 48.6);
  puppet.update(49);
  assert.strictEqual(puppet.animationPlayer.ikAnimation, blended);
  puppet.play('c', { fadeDuration: 1000 });
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.x!.value, 48.6);
  puppet.update(100);
  assert.approximately(puppet.animationPlayer.ikAnimation.get('arm')!.x!.value, 41.74, 1e-12);
  assert.equal(blended.get('arm')!.x!.value, 48.6);
  puppet.destroy();
});

test('a held stepped overlay fade recomputes sparse fallback when the smooth layer below changes', () => {
  const puppet = fixture([
    clip('base', [
      { time: 0, x: 40, y: 70 },
      { time: 1000, x: 60 },
    ]),
    { ...clip('overlay', [{ time: 0, x: 80 }]), playback: { mode: 'stepped', fps: 10 } },
  ]);
  puppet.play('overlay', { layer: 'overlay', fadeDuration: 1000 });
  puppet.update(100);
  const first = puppet.animationPlayer.ikAnimation;
  assert.approximately(first.get('arm')!.x!.value, 45.8, 1e-12);
  puppet.update(50);
  assert.approximately(puppet.animationPlayer.ikAnimation.get('arm')!.x!.value, 46.7, 1e-12);
  assert.equal(puppet.animationPlayer.ikAnimation.get('arm')!.y!.value, 70);
  assert.approximately(first.get('arm')!.x!.value, 45.8, 1e-12);
  puppet.destroy();
});

test('unreachable animated targets retain clamping and singular transforms retain the solver diagnostic', () => {
  const puppet = fixture([clip('far', [{ time: 0, x: 1000, y: 1000 }])]);
  assert.equal(puppet.getIK('arm').status, 'clamped');
  assert.approximately(Math.hypot(hand(puppet).x, hand(puppet).y), 110, 1e-8);
  puppet.container.setScale(0);
  puppet.syncPose();
  assert.equal(puppet.getIK('arm').status, 'singular-transform');
  puppet.destroy();
});

test('old clips and empty tracks preserve static targets, disabled constraints, and no-target behavior', () => {
  for (const ikTracks of [undefined, {}, { arm: [] }]) {
    const animation = clip();
    if (ikTracks === undefined) delete animation.ikTracks;
    else animation.ikTracks = ikTracks;
    const puppet = fixture([animation]);
    assert.equal(puppet.getIK('arm').status, 'inactive');
    puppet.setIKTarget('arm', 60, 60);
    puppet.syncIK();
    reaches(puppet, { x: 60, y: 60 });
    puppet.update(500);
    reaches(puppet, { x: 60, y: 60 });
    puppet.getIK('arm').enabled = false;
    puppet.sampleAnimation(500);
    assert.equal(puppet.getIK('arm').status, 'inactive');
    assert.approximately(puppet.getBone('upper').pose.rotation, 0.3, 1e-12);
    puppet.destroy();
  }
});

test('compilation owns IK maps and values; evaluation never alters source keys, bind pose or exported authored pose', () => {
  const source = clip();
  const before = JSON.stringify(source);
  const compiled = compileClip(source, rig());
  const pose = evaluateIKClip(compiled, 250);
  assert.equal(pose.get('arm')!.x!.value, 45);
  assert.isTrue(Object.isFrozen(pose.get('arm')!.x));
  assert.isFalse('set' in compiled.ikTracks![0]!.properties);
  const puppet = fixture([source]);
  const bind = { ...puppet.getBone('upper').bindPose };
  for (const time of [500, 1000, 0, 250]) {
    puppet.sampleAnimation(time);
    puppet.syncIK();
  }
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(puppet.getBone('upper').bindPose, bind);
  assert.approximately(puppet.exportPose('authored', { onlyChanged: false }).bones.upper!.rotation!, 0.2, 1e-12);
  const external: CompiledClip = {
    ...compiled,
    ikTracks: [
      {
        constraint: 'arm',
        properties: new Map([
          ['x', [{ time: 0, value: 10 }]],
          ['y', [{ time: 0, value: 80 }]],
        ]),
      },
    ],
  };
  const skeleton = rig();
  const joints = new Map(skeleton.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const player = new AnimationPlayer(skeleton, joints, [external]);
  (external.ikTracks![0]!.properties.get('x')![0] as { value: number }).value = 999;
  player.play(external.name);
  assert.equal(player.ikAnimation.get('arm')!.x!.value, 10);
  player.dispose();
  puppet.destroy();
});

test('external compiled IK channels reject invalid values, timelines, properties and constraint references', () => {
  const compiled = compileClip(clip(), rig());
  const skeleton = rig();
  const joints = new Map(skeleton.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  for (const properties of [
    new Map([['mix', [{ time: 0, value: 2 }]]]),
    new Map([['x', [{ time: 0, value: NaN }]]]),
    new Map([['x', []]]),
    new Map([
      [
        'x',
        [
          { time: 500, value: 1 },
          { time: 100, value: 2 },
        ],
      ],
    ]),
    new Map([['rotation', [{ time: 0, value: 1 }]]]),
  ])
    assert.throws(
      () =>
        new AnimationPlayer(skeleton, joints, [
          { ...compiled, ikTracks: [{ constraint: 'arm', properties }] } as CompiledClip,
        ]),
    );
  assert.throws(
    () =>
      new AnimationPlayer(skeleton, joints, [
        { ...compiled, ikTracks: [{ constraint: 'missing', properties: new Map() }] },
      ]),
  );
});

test.each([{ mode: 'smooth' } as const, { mode: 'stepped', fps: 10 } as const])(
  'editor scrub and editor playback use runtime IK with $mode timing, no events and no source edits',
  (playback) => {
    const animation = {
      ...clip(),
      playback,
      events: [
        { time: 0, name: 'start' },
        { time: 500, name: 'middle' },
      ],
    };
    const puppet = fixture([animation]);
    const state = new AnimationEditorState(puppet.rig, [animation]);
    state.selectAnimation(animation.name);
    const event = vi.fn();
    puppet.onAnimationEvent(event);
    const playerEvent = vi.spyOn(AnimationPlayer.prototype, 'onAnimationEvent');
    const preview = new AnimationEditorPreview(state, puppet);
    const working = state.workingAnimation;
    for (const time of [0, 0.375, 0.5, 1, 0.25]) {
      state.setCurrentTime(time);
      const runtime = fixture([animation]);
      runtime.sampleAnimation(time * 1000, { mode: 'playback' });
      assert.approximately(puppet.getBone('upper').pose.rotation, runtime.getBone('upper').pose.rotation, 1e-10);
      assert.approximately(puppet.getBone('lower').pose.rotation, runtime.getBone('lower').pose.rotation, 1e-10);
      runtime.destroy();
    }
    state.setCurrentTime(0.5);
    puppet.setFacing('left');
    reaches(puppet, { x: 30, y: 80 });
    state.restart();
    state.play();
    state.advancePlayback(0.5);
    reaches(puppet, { x: 30, y: 80 });
    assert.equal(event.mock.calls.length, 0);
    assert.equal(playerEvent.mock.calls.length, 0);
    assert.strictEqual(state.workingAnimation, working);
    preview.dispose();
    playerEvent.mockRestore();
    puppet.syncPose();
    reaches(puppet, { x: 60, y: 60 });
    puppet.destroy();
  },
);

test('late-bound weapon providers observe rendered animated primary and nested constraints run in priority order', () => {
  const definition = rig();
  const nested = new Rig({
    root: definition.root,
    bones: [
      ...definition.bones,
      { id: 'gripUpper', parent: 'hand' },
      { id: 'gripLower', parent: 'gripUpper', y: 30 },
      { id: 'gripHand', parent: 'gripLower', y: 20 },
    ],
    ik: [
      ...definition.ik!,
      { name: 'grip', rootBone: 'gripUpper', middleBone: 'gripLower', endBone: 'gripHand', priority: 1 },
    ],
  });
  const animation = { ...clip(), ikTracks: { ...clip().ikTracks, grip: [{ time: 0, x: -900, y: 900, mix: 0 }] } };
  const puppet = new Puppet(puppetScene(), { rig: nested, animations: [animation], autoUpdate: false });
  const grip = puppet.getIK('grip');
  grip.setTargetProvider(() => {
    reaches(puppet, { x: 60, y: 60 });
    return localToWorld({ x: 20, y: 20 }, puppet.getBone('hand').container.getWorldTransformMatrix());
  });
  puppet.play(animation.name);
  assert.equal(grip.status, 'solved');
  const expected = localToWorld({ x: 20, y: 20 }, puppet.getBone('hand').container.getWorldTransformMatrix());
  const actual = localToWorld({ x: 0, y: 0 }, puppet.getBone('gripHand').container.getWorldTransformMatrix());
  assert.approximately(actual.x, expected.x, 1e-8);
  assert.approximately(actual.y, expected.y, 1e-8);
  grip.setTargetProvider(undefined);
  puppet.syncIK();
  assert.equal(grip.status, 'inactive', 'generic zero mix is restored after specialized ownership ends');
  puppet.destroy();
});

test('actual foot planting and secondary katana grips retain targets and influence against conflicting generic tracks', () => {
  const scene = puppetScene();
  const definition = new Rig({ root: demoRig.root, bones: demoRig.bones, ik: paperDollIK });
  const ikTracks = Object.fromEntries(
    paperDollIK.map((chain) => [chain.name, [{ time: 0, x: -900, y: -900, mix: 0 }]]),
  );
  const puppet = new Puppet(scene, {
    rig: definition,
    x: 380,
    y: 362,
    animations: [
      { ...walk, ikTracks },
      { ...sword, ikTracks },
    ],
    autoUpdate: false,
  });
  const feet = new DemoFootPlanting(scene, puppet);
  for (const facing of ['right', 'left'] as const) {
    puppet.setFacing(facing).play('walk');
    puppet.update(250);
    const frame = feet.update(true);
    puppet.syncPose();
    for (const side of ['left', 'right'] as const) {
      const leg = puppet.getIK(`${side}LegIK`);
      assert.equal(leg.mix, frame.walkFeet![side].mix);
      if (leg.mix > 0) {
        assert.deepEqual(leg.resolvedTarget, frame.targets[side]);
        assert.notEqual(leg.status, 'inactive');
      }
    }
  }
  const katana = new Katana(scene);
  const controller = new DemoKatanaController(puppet, katana);
  for (const facing of ['right', 'left'] as const) {
    puppet.setFacing(facing).play('sword');
    controller.syncMode(false);
    controller.configureArms({ x: 420, y: 300 }, true, false);
    controller.reattach();
    puppet.syncPose();
    const secondary = puppet.getIK(facing === 'right' ? 'leftArmIK' : 'rightArmIK');
    assert.deepEqual(secondary.resolvedTarget, controller.getSecondaryTarget());
    assert.notEqual(secondary.status, 'inactive');
    assert.deepEqual(puppet.getIK(facing === 'right' ? 'rightArmIK' : 'leftArmIK').target, { x: 420, y: 300 });
    feet.update(false);
    puppet.syncIK();
    assert.isFalse(puppet.getIK('leftLegIK').enabled);
    assert.isFalse(puppet.getIK('rightLegIK').enabled);
  }
  puppet.destroy();
  katana.container.destroy();
});
