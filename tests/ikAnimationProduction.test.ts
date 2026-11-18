import { assert, expect, test, vi } from 'vitest';
import { AnimationEditorGhostLayer } from '../src/devtools/animation-editor/AnimationEditorGhostLayer.js';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { evaluateIKTarget } from '../src/devtools/animation-editor/ikInspectorSampling.js';
import { createBoneSymmetryMapping } from '../src/devtools/shared/boneSymmetry.js';
import { localToWorld } from '../src/engine/affineMath.js';
import { compileClip, type AnimationClip } from '../src/engine/AnimationClip.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { UnsupportedFormatVersionError, parseAnimationClip } from '../src/engine/externalData.js';
import { evaluateIKClip } from '../src/engine/ik/AnimationIKPose.js';
import { blendIKRotation, solveTwoBoneIK } from '../src/engine/ik/solveTwoBoneIK.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';
import { requestUrl } from './helpers/requestUrl.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function skeleton() {
  return new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      ...(['left', 'right'] as const).flatMap((side) => [
        { id: `${side}Upper`, parent: 'root', x: side === 'left' ? -15 : 15 },
        { id: `${side}Lower`, parent: `${side}Upper`, x: 60 },
        { id: `${side}Hand`, parent: `${side}Lower`, x: 50 },
      ]),
    ],
    ik: (['left', 'right'] as const).map((side, priority) => ({
      name: `${side}IK`,
      rootBone: `${side}Upper`,
      middleBone: `${side}Lower`,
      endBone: `${side}Hand`,
      priority,
    })),
  });
}

function animation(mix = 1): AnimationClip {
  return {
    name: 'reach',
    duration: 1000,
    loop: false,
    interpolation: 'linear',
    tracks: {
      leftUpper: [
        { time: 0, rotation: 0.1 },
        { time: 1000, rotation: 0.5 },
      ],
      leftLower: [
        { time: 0, rotation: -0.2 },
        { time: 1000, rotation: 0.6 },
      ],
    },
    ikTracks: {
      leftIK: [
        { time: 0, x: 45, y: 60, mix },
        { time: 1000, x: 15, y: 80, mix },
      ],
      rightIK: [
        { time: 0, x: 75, y: -60, mix },
        { time: 1000, x: 45, y: -80, mix },
      ],
    },
    events: [
      { time: 0, name: 'start' },
      { time: 500, name: 'touch', data: { object: 'cup', values: [1, true] } },
    ],
  };
}

test('zero-duration IK animations fail validation before render allocation; empty legacy rigs play normally', () => {
  const scene = puppetScene();
  const containers = vi.spyOn(scene.add, 'container');
  const zero = { ...animation(), duration: 0 };
  assert.throws(() => new Puppet(scene, { rig: skeleton(), animations: [zero] }), 'duration');
  assert.equal(containers.mock.calls.length, 0);
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const old: AnimationClip = { name: 'old', duration: 1000, loop: false, tracks: { root: [{ time: 0, x: 5 }] } };
  const puppet = new Puppet(scene, { rig, animations: [old], autoUpdate: false });
  try {
    puppet.play('old');
    puppet.update(10000);
    assert.equal(puppet.getBone('root').pose.x, 5);
    assert.equal(puppet.posePipeline.player.ikAnimation.size, 0);
    assert.deepEqual(parseAnimationClip({ version: 1, ...old }, rig), old);
  } finally {
    puppet.destroy();
  }
});

test.each([0, 0.5, 1])('both authored rotations precede IK correction at influence %s without accumulating', (mix) => {
  const clip = animation(mix);
  const original = JSON.stringify(clip);
  const puppet = new Puppet(puppetScene(), { rig: skeleton(), animations: [clip], autoUpdate: false });
  try {
    puppet.play('reach');
    for (const time of [0, 500, 1000, 500, 0]) {
      puppet.sampleAnimation(time);
      const t = time / 1000;
      const upper = 0.1 + 0.4 * t;
      const lower = -0.2 + 0.8 * t;
      const solved = solveTwoBoneIK({
        root: { x: -15, y: 0 },
        target: { x: 45 - 30 * t, y: 60 + 20 * t },
        lengthA: 60,
        lengthB: 50,
        bendDirection: 1,
      });
      for (let pass = 0; pass < 3; ++pass) {
        puppet.posePipeline.syncIK();
        assert.closeTo(
          puppet.getBone('leftUpper').pose.rotation,
          blendIKRotation(upper, solved.rootRotation, mix),
          1e-10,
        );
        assert.closeTo(
          puppet.getBone('leftLower').pose.rotation,
          blendIKRotation(lower, solved.middleRotation, mix),
          1e-10,
        );
      }
      const pose = puppet.exportPose('authored', { onlyChanged: false });
      assert.closeTo(pose.bones.leftUpper!.rotation!, upper, 1e-10);
      assert.closeTo(pose.bones.leftLower!.rotation!, lower, 1e-10);
    }
    assert.equal(JSON.stringify(clip), original);
  } finally {
    puppet.destroy();
  }
});

test.each(['smooth', 'stepped'] as const)(
  'loop boundaries, large deltas and speeds retain %s target/event timing',
  (mode) => {
    const clip = { ...animation(), loop: true, playback: mode === 'smooth' ? { mode } : { mode, fps: 10 } };
    const puppet = new Puppet(puppetScene(), { rig: skeleton(), animations: [clip], autoUpdate: false });
    const events: string[] = [];
    puppet.onAnimationEvent((event) => events.push(event.name));
    try {
      puppet.play('reach');
      puppet.setAnimationSpeed(2);
      puppet.update(1250); // 2.5 loops, ending exactly on the middle marker.
      assert.equal(puppet.posePipeline.player.elapsedTime, 500);
      assert.equal(puppet.posePipeline.player.ikAnimation.get('leftIK')!.x!.value, 30);
      assert.deepEqual(events, ['start', 'touch', 'start', 'touch', 'start', 'touch']);
      const before = [...events];
      for (const time of [1000, 0, 599, 500]) {
        puppet.sampleAnimation(time, { mode: 'playback' });
        evaluateIKTarget(clip, puppet.rig, 'leftIK', time);
      }
      assert.deepEqual(events, before, 'inspection and scrubbing are event-free');
      puppet.update(250);
      assert.equal(puppet.posePipeline.player.elapsedTime, 0);
      assert.equal(puppet.posePipeline.player.ikAnimation.get('leftIK')!.x!.value, 45);
      puppet.setAnimationSpeed(0);
      puppet.update(10000);
      assert.equal(puppet.posePipeline.player.elapsedTime, 0);
    } finally {
      puppet.destroy();
    }
  },
);

test.each([false, true])('one-key and missing-position channels remain safe (loop %s)', (loop) => {
  const rig = skeleton();
  const clip: AnimationClip = {
    name: 'zero',
    duration: 1000,
    loop,
    tracks: {},
    ikTracks: { leftIK: [{ time: 0, mix: 0.5 }], rightIK: [{ time: 0, x: 75, y: 60 }] },
  };
  const puppet = new Puppet(puppetScene(), { rig, animations: [clip], autoUpdate: false });
  try {
    puppet.play('zero');
    puppet.update(100000);
    puppet.sampleAnimation(0);
    assert.equal(puppet.getIK('leftIK').status, 'inactive', 'mix-only cannot invent a position');
    assert.equal(puppet.getIK('rightIK').status, 'solved');
    puppet.restart();
    for (const bone of rig.bones)
      for (const value of Object.values(puppet.getBone(bone.id).pose)) assert.isTrue(Number.isFinite(value));
  } finally {
    puppet.destroy();
  }
});

test('editor export/import stabilizes and CharacterLoader/Puppet play the same authored package', async () => {
  const rig = skeleton();
  const source = animation();
  const state = new AnimationEditorState(rig, [source]);
  state.selectAnimation('reach');
  state.setCurrentTime(0.5);
  state.ik.selectIKConstraint('leftIK');
  state.ik.setTemporaryIKProperty('x', 30);
  state.ik.setTemporaryIKProperty('y', 70);
  assert.isTrue(state.ik.commitIKTarget());
  state.ik.setIKPropertyKeyframe('leftIK', 'mix', 0.5);
  const json = state.exportJson();
  const authored = state.workingAnimation!;
  for (let round = 0; round < 3; ++round) {
    assert.isTrue(state.importJson(json, { confirmDiscard: () => true }));
    assert.equal(state.exportJson(), json);
  }
  const files: Record<string, unknown> = {
    'character.json': {
      version: 1,
      id: 'demo',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: ['animations/reach.json'],
      textures: {},
    },
    'rig.json': { version: 1, root: rig.root, bones: rig.bones, ik: rig.ik },
    'skin.json': { version: 1, name: 'default', slots: {} },
    'animations/reach.json': JSON.parse(json) as unknown,
  };
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(requestUrl(input)).pathname.replace('/characters/demo/', '');
    return new Response(JSON.stringify(files[path]), { status: Object.hasOwn(files, path) ? 200 : 404 });
  };
  const definition = await CharacterLoader.load('https://example.test/characters/demo/character.json', fetcher);
  const scene = puppetScene();
  const loaded = new Puppet(scene, { definition, autoUpdate: false });
  const direct = new Puppet(scene, { rig, animations: [authored], autoUpdate: false });
  try {
    loaded.play('reach');
    direct.play('reach');
    for (const time of [0, 250, 500, 750, 1000]) {
      loaded.sampleAnimation(time);
      direct.sampleAnimation(time);
      assert.deepEqual([...loaded.posePipeline.player.ikAnimation], [...direct.posePipeline.player.ikAnimation]);
      for (const bone of rig.bones) assert.deepEqual(loaded.getBone(bone.id).pose, direct.getBone(bone.id).pose);
      assert.deepEqual(
        [...evaluateIKClip(compileClip(authored, rig), time)],
        [...loaded.posePipeline.player.ikAnimation],
      );
    }
    assert.deepEqual(definition.animations[0]!.events, source.events);
    assert.equal(state.exportJson(), json);
    assert.deepEqual(source, animation());
  } finally {
    loaded.destroy();
    direct.destroy();
  }
  files['animations/reach.json'] = { ...JSON.parse(json), ikTracks: { missing: [{ time: 0, x: 1 }] } };
  await expect(CharacterLoader.load('https://example.test/characters/demo/character.json', fetcher)).rejects.toThrow(
    'Unknown IK constraint',
  );
});

test('invalid IK imports and unsupported versions preserve the working session and its history', () => {
  const rig = skeleton();
  const state = new AnimationEditorState(rig, [animation()]);
  state.selectAnimation('reach');
  state.ik.setIKPropertyKeyframe('leftIK', 'x', 12);
  const working = state.workingAnimation;
  const history = state.historyLength;
  for (const input of [
    '{',
    JSON.stringify({ ...working, ikTracks: { missing: [] } }),
    JSON.stringify({ ...working, ikTracks: { leftIK: [{ time: -1, mix: 2 }] } }),
    JSON.stringify({ ...working, version: 0 }),
    JSON.stringify({ ...working, version: 2 }),
  ]) {
    assert.isFalse(state.importJson(input, { confirmDiscard: () => true }));
    assert.strictEqual(state.workingAnimation, working);
    assert.equal(state.historyLength, history);
  }
  assert.throws(() => parseAnimationClip({ ...animation(), version: 0 }, rig), UnsupportedFormatVersionError);
  assert.isTrue(state.undo());
  assert.equal(state.workingAnimation!.ikTracks!.leftIK![0]!.x, 45);
  assert.isTrue(state.redo());
  assert.equal(state.workingAnimation!.ikTracks!.leftIK![0]!.x, 12);
});

test('bone mirroring retains IK tracks, and ghost refresh never solves or changes live IK', () => {
  const rig = skeleton();
  const state = new AnimationEditorState(rig, [animation()]);
  state.selectAnimation('reach');
  const mapping = createBoneSymmetryMapping(rig, {
    automaticCandidates: [
      { leftBoneId: 'leftUpper', rightBoneId: 'rightUpper' },
      { leftBoneId: 'leftLower', rightBoneId: 'rightLower' },
      { leftBoneId: 'leftHand', rightBoneId: 'rightHand' },
    ],
  });
  assert.isTrue(mapping.success);
  state.setSymmetryMapping(mapping.mapping);
  const tracks = state.workingAnimation!.ikTracks;
  state.setCurrentTime(0.5);
  assert.isTrue(state.keyframes.mirrorCurrentPoseToKeys('left-to-right', { boneIds: ['leftUpper', 'leftLower'] }));
  assert.strictEqual(state.workingAnimation!.ikTracks, tracks);
  const scene = puppetScene();
  const puppet = new Puppet(scene, { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  const ghosts = new AnimationEditorGhostLayer(scene, state, puppet);
  const constraint = puppet.getIK('leftIK');
  const apply = vi.spyOn(constraint, 'apply');
  const sync = vi.spyOn(puppet.posePipeline, 'syncPose');
  try {
    const before = {
      pose: { ...puppet.getBone('leftUpper').pose },
      target: constraint.resolvedTarget,
      channels: [...evaluateIKClip(compileClip(state.workingAnimation!, rig), 500)],
    };
    ghosts.setSettings({ enabled: true, previousCount: 3, nextCount: 3 });
    ghosts.updateFrame(() => {});
    state.sampleGhostPose(0.4);
    assert.equal(apply.mock.calls.length, 0);
    assert.deepEqual(puppet.getBone('leftUpper').pose, before.pose);
    assert.strictEqual(constraint.resolvedTarget, before.target);
    const ghost = state.sampleGhostPose(0.5)!;
    assert.closeTo(ghost.get('leftUpper')!.rotation!, 0.3, 1e-10);
    assert.notEqual(ghost.get('leftUpper')!.rotation, puppet.getBone('leftUpper').pose.rotation);
    const images = vi.spyOn(scene.add, 'image');
    const containers = vi.spyOn(scene.add, 'container');
    const exported = state.exportJson();
    for (const speed of [0.25, 1, 2]) {
      state.setPlaybackSpeed(speed);
      for (let frame = 0; frame < 40; ++frame)
        ghosts.updateFrame(() => state.setCurrentTime(0.1 + (frame % 30) * 0.025));
      state.setCurrentTime(0.4);
      state.play();
      for (let frame = 0; frame < 10; ++frame) ghosts.updateFrame(() => state.advancePlayback(1 / 120));
      state.pause();
    }
    assert.equal(images.mock.calls.length, 0);
    assert.equal(containers.mock.calls.length, 0);
    assert.equal(state.exportJson(), exported);
    assert.isAbove(sync.mock.calls.length, 100);
    assert.equal(
      apply.mock.calls.length,
      sync.mock.calls.length,
      'one solver pass per changed preview, none for ghosts',
    );
  } finally {
    ghosts.dispose();
    preview.dispose();
    puppet.destroy();
  }
});

test('disposing an old preview twice cannot clear a replacement preview or run stale subscriptions', () => {
  const rig = skeleton();
  const state = new AnimationEditorState(rig, [
    animation(),
    { name: 'empty', duration: 1000, loop: false, tracks: {} },
  ]);
  state.selectAnimation('reach');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const first = new AnimationEditorPreview(state, puppet);
  first.dispose();
  const replacement = new AnimationEditorPreview(state, puppet);
  const sync = vi.spyOn(puppet.posePipeline, 'syncPose');
  try {
    first.dispose();
    state.setCurrentTime(0.5);
    assert.equal(sync.mock.calls.length, 1);
    assert.deepEqual(puppet.getIK('leftIK').resolvedTarget, { x: 30, y: 70 });
    state.selectAnimation('empty');
    assert.equal(puppet.getIK('leftIK').status, 'inactive');
    state.selectAnimation('reach');
    puppet.setFacing('left');
    const target = localToWorld({ x: 45, y: 60 }, puppet.container.getWorldTransformMatrix());
    assert.deepEqual(puppet.getIK('leftIK').resolvedTarget, target);
    replacement.dispose();
    sync.mockClear();
    state.setCurrentTime(0.75);
    assert.equal(sync.mock.calls.length, 0);
  } finally {
    replacement.dispose();
    puppet.destroy();
  }
});
