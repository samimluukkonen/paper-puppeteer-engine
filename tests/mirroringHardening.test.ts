import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { mirrorCurrentPoseToKeys } from '../src/devtools/animation-editor/keyframeMirroring.js';
import { createBoneSymmetryMapping, inferBoneSymmetryPairs } from '../src/devtools/shared/boneSymmetry.js';
import { mirrorPose } from '../src/devtools/shared/poseMirroring.js';
import { compileClip, type AnimationClip } from '../src/engine/AnimationClip.js';
import { AnimationPlayer, type FiredAnimationEvent } from '../src/engine/AnimationPlayer.js';
import { evaluateClip } from '../src/engine/AnimationPose.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { parseAnimationClip, validateAnimationDefinition } from '../src/engine/externalData.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import { createTransform, transformProperties } from '../src/engine/types.js';
import { requestUrl } from './helpers/requestUrl.js';

function mappingFor(rig: Rig) {
  const result = createBoneSymmetryMapping(rig, { automaticCandidates: inferBoneSymmetryPairs(rig).pairs });
  assert.isTrue(result.success);
  return result.mapping;
}

// All six humanoid limb pairs, with rotated nested rest frames, unequal lengths and joint offsets.
function humanoid(asymmetric = false) {
  return new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'torso', parent: 'root' },
      ...(['left', 'right'] as const).flatMap((side) => {
        const sign = side === 'left' ? 1 : -1;
        const extra = asymmetric && side === 'right' ? 7 : 0;
        return [
          { id: `${side}UpperArm`, parent: 'torso', x: sign * (15 + extra), rotation: sign * 0.3, length: 30 + extra },
          { id: `${side}Forearm`, parent: `${side}UpperArm`, rotation: sign * -0.2, length: 20 + extra },
          { id: `${side}Hand`, parent: `${side}Forearm`, x: sign * (3 + extra), rotation: sign * 0.1 },
          { id: `${side}Thigh`, parent: 'root', x: sign * (9 + extra), rotation: sign * -0.15, length: 45 + extra },
          { id: `${side}LowerLeg`, parent: `${side}Thigh`, rotation: sign * 0.25, length: 40 + extra },
          { id: `${side}Foot`, parent: `${side}LowerLeg`, x: sign * (2 + extra), rotation: sign * -0.1 },
        ];
      }),
      { id: 'leftDecoration', parent: 'torso' }, // Missing counterpart is intentionally unpaired.
    ],
  });
}

function session(playback: AnimationClip['playback'] = { mode: 'smooth' }, interpolation?: 'linear') {
  const rig = humanoid(true);
  const animation: AnimationClip = {
    name: 'hardening',
    duration: 1000,
    loop: true,
    playback,
    ...(interpolation === undefined ? {} : { interpolation }),
    tracks: {
      leftForearm: [
        { time: 0, rotation: -0.2 },
        { time: 400, rotation: 0.6 },
        { time: 1000, rotation: 0.2 },
      ],
      leftFoot: [
        { time: 0, x: 2 },
        { time: 400, x: 5 },
        { time: 1000, x: 3 },
      ],
      rightForearm: [
        { time: 400, rotation: 1.1, y: 37 },
        { time: 1000, rotation: 0.9 },
      ],
    },
    events: [{ time: 300, name: 'cue', data: { nested: ['unchanged', { count: 2 }] } }],
  };
  const state = new AnimationEditorState(rig, [animation]);
  state.selectAnimation(animation.name);
  state.setSymmetryMapping(mappingFor(rig));
  return { rig, animation, state };
}

function checkSelection(state: AnimationEditorState) {
  assert.deepEqual(validateAnimationDefinition(state.workingAnimation, state.rig!), []);
  for (const key of state.selectedKeys)
    assert.isDefined(state.findBonePropertyKeyframe(key.boneId, key.property, key.time));
  if (state.primaryKey) assert.include(state.selectedKeys, state.primaryKey);
}

test.each([false, true])(
  'all humanoid arm/leg pairs round-trip with asymmetric rest offsets/lengths: %s',
  (asymmetric) => {
    const rig = humanoid(asymmetric);
    const mapping = mappingFor(rig);
    assert.lengthOf(mapping.pairs, 6);
    assert.include(mapping.unpairedBoneIds, 'leftDecoration');
    const pose = new Map(rig.bones.map((bone) => [bone.id, createTransform(bone)]));
    for (const [index, values] of [...pose.values()].entries()) {
      values.x += index * 0.3;
      values.y -= index * 0.2;
      values.rotation += index * 0.06;
      values.scaleX *= 1.2;
      values.scaleY *= 0.8;
    }
    const source = JSON.stringify([...pose]);
    for (const directions of [
      ['swap', 'swap'],
      ['left-to-right', 'right-to-left'],
    ] as const) {
      const first = mirrorPose(pose, rig, mapping, directions[0]);
      assert.isTrue(first.success, JSON.stringify(first.issues));
      const second = mirrorPose(first.pose, rig, mapping, directions[1]);
      assert.isTrue(second.success, JSON.stringify(second.issues));
      for (const bone of rig.bones) {
        if (directions[0] !== 'swap' && bone.id.startsWith('right')) continue;
        for (const property of transformProperties)
          assert.closeTo(
            second.pose.get(bone.id)![property]!,
            pose.get(bone.id)![property],
            1e-9,
            `${bone.id}.${property}`,
          );
      }
    }
    assert.equal(JSON.stringify([...pose]), source);
  },
);

test('all six symmetric limb pairs reflect world joint positions and axes under nested rotations', () => {
  const rig = humanoid();
  const mapping = mappingFor(rig);
  const pose = new Map(rig.bones.map((bone) => [bone.id, createTransform(bone)]));
  for (const { leftBoneId } of mapping.pairs) {
    const values = pose.get(leftBoneId)!;
    values.rotation += 0.45;
    values.x += 2;
    values.y += 3;
    values.scaleX *= 1.3;
    values.scaleY *= 0.7;
  }
  const result = mirrorPose(pose, rig, mapping, 'left-to-right');
  assert.isTrue(result.success);
  // Independent T/R/S point composition, including the endpoints of each local axis.
  const pointInWorld = (id: string, mirrored: boolean, x: number, y: number): { x: number; y: number } => {
    const bone = rig.getBone(id);
    const transform = { ...createTransform(bone), ...(mirrored ? result.pose : pose).get(id) };
    const px =
      transform.x +
      Math.cos(transform.rotation) * x * transform.scaleX -
      Math.sin(transform.rotation) * y * transform.scaleY;
    const py =
      transform.y +
      Math.sin(transform.rotation) * x * transform.scaleX +
      Math.cos(transform.rotation) * y * transform.scaleY;
    return bone.parent === undefined ? { x: px, y: py } : pointInWorld(bone.parent, mirrored, px, py);
  };
  for (const { leftBoneId, rightBoneId } of mapping.pairs) {
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      const source = pointInWorld(leftBoneId, false, x, y);
      const target = pointInWorld(rightBoneId, true, -x, y);
      assert.closeTo(target.x, -source.x, 1e-9, rightBoneId);
      assert.closeTo(target.y, source.y, 1e-9, rightBoneId);
    }
  }
});

test('rotation winding round-trips as an orientation rather than an identical numeric angle', () => {
  const rig = humanoid();
  const mapping = mappingFor(rig);
  const original = 8 * Math.PI + 0.6;
  const first = mirrorPose(new Map([['leftForearm', { rotation: original }]]), rig, mapping, 'swap');
  assert.isTrue(first.success);
  const second = mirrorPose(first.pose, rig, mapping, 'swap');
  assert.isTrue(second.success);
  const actual = second.pose.get('leftForearm')!.rotation!;
  assert.notEqual(actual, original);
  assert.closeTo(Math.sin(actual), Math.sin(original), 1e-9);
  assert.closeTo(Math.cos(actual), Math.cos(original), 1e-9);
});

test('unanimated singular pairs do not block sparse current-pose authoring; explicit scopes still validate them', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'leftArm', parent: 'root' },
      { id: 'rightArm', parent: 'root' },
      { id: 'leftDecoration', parent: 'root', scaleX: 0 },
      { id: 'rightDecoration', parent: 'root' },
    ],
  });
  const animation: AnimationClip = {
    name: 'sparse',
    duration: 1000,
    loop: false,
    tracks: { leftArm: [{ time: 0, rotation: 0.6 }] },
  };
  const mapping = mappingFor(rig);
  const result = mirrorCurrentPoseToKeys(animation, rig, mapping, 300, 'left-to-right');
  assert.deepEqual(result.keys, [{ boneId: 'rightArm', property: 'rotation', timeMs: 300 }]);
  assert.closeTo(result.animation.tracks.rightArm![0]!.rotation!, -0.6, 1e-9);
  assert.isFalse(Object.hasOwn(result.animation.tracks, 'rightDecoration'));
  assert.throws(
    () =>
      mirrorCurrentPoseToKeys(animation, rig, mapping, 300, 'left-to-right', {
        boneIds: ['leftDecoration'],
        properties: ['rotation'],
      }),
    /nonzero/,
  );
});

for (const interpolation of [undefined, 'linear'] as const) {
  test.each([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }] as const)(
    `${interpolation ?? 'implicit'} interpolation survives mirrored mixed-property clipboard, movement and history ($mode)`,
    (playback) => {
      const { state, animation } = session(playback, interpolation);
      const source = state.sourceAnimation;
      const original = JSON.stringify(animation);
      const baseline = state.workingAnimation;
      state.selectBone('leftForearm');
      state.setCurrentTime(0.2);
      assert.isTrue(state.mirrorCurrentPoseToKeys('left-to-right'));
      const pose = state.workingAnimation;
      state.selectKeyframes([
        { boneId: 'leftForearm', property: 'rotation', time: 0.4 },
        { boneId: 'leftFoot', property: 'x', time: 0.4 },
      ]);
      assert.isTrue(state.mirrorSelectedKeyframes('left-to-right'));
      const mirrored = state.workingAnimation;
      assert.deepEqual(Object.keys(mirrored!.tracks.rightForearm!.find((row) => row.time === 400)!).sort(), [
        'rotation',
        'time',
        'y',
      ]);
      assert.deepEqual(Object.keys(mirrored!.tracks.rightFoot![0]!).sort(), ['time', 'x']);
      assert.isTrue(state.copySelectedKeyframes());
      state.setCurrentTime(0.6);
      assert.isTrue(state.pasteKeyframes());
      const pasted = state.workingAnimation;
      assert.isTrue(state.moveSelectedKeyframe(0.7));
      const moved = state.workingAnimation;
      assert.isTrue(state.setAuthoredInterpolation(interpolation === undefined ? 'linear' : undefined));
      const declared = state.workingAnimation;
      assert.isTrue(state.undo());
      assert.strictEqual(state.workingAnimation, moved);
      assert.isTrue(state.undo());
      assert.strictEqual(state.workingAnimation, pasted);
      assert.isTrue(state.redo());
      assert.strictEqual(state.workingAnimation, moved);
      state.selectKeyframes([{ boneId: 'rightForearm', property: 'rotation', time: 0.4 }]);
      assert.isTrue(state.mirrorSelectedKeyframes('right-to-left'));
      const opposite = state.workingAnimation;
      assert.isTrue(state.undo());
      assert.strictEqual(state.workingAnimation, moved);
      assert.isTrue(state.redo());
      assert.strictEqual(state.workingAnimation, opposite);
      state.markSaved();
      assert.isFalse(state.dirty);
      const snapshots = [baseline, pose, mirrored, pasted, moved, opposite];
      for (let index = snapshots.length - 2; index >= 0; --index) {
        assert.isTrue(state.undo());
        assert.strictEqual(state.workingAnimation, snapshots[index]);
        assert.isTrue(state.dirty);
        checkSelection(state);
      }
      for (const snapshot of snapshots.slice(1)) {
        assert.isTrue(state.redo());
        assert.strictEqual(state.workingAnimation, snapshot);
        checkSelection(state);
      }
      assert.isFalse(state.dirty);
      assert.isFalse(state.redo());
      assert.notStrictEqual(state.workingAnimation, declared, 'opposite mirror branches over the undone declaration');
      assert.deepEqual(state.workingAnimation!.playback, playback);
      assert.equal(state.workingAnimation!.interpolation, interpolation);
      assert.deepEqual(state.workingAnimation!.events, animation.events);
      assert.strictEqual(state.sourceAnimation, source);
      assert.equal(JSON.stringify(animation), original);
    },
  );
}

test.each(['smooth', 'stepped'] as const)(
  'mirrored keys play through the normal %s runtime and editor clock, including events',
  (mode) => {
    const { rig, state, animation } = session(mode === 'stepped' ? { mode, fps: 10 } : { mode });
    state.selectKeyframes([0, 0.4, 1].map((time) => ({ boneId: 'leftForearm', property: 'rotation', time })));
    const events = vi.fn<(event: FiredAnimationEvent) => void>();
    state.onAnimationEvent(events);
    assert.isTrue(state.mirrorSelectedKeyframes('left-to-right'));
    assert.equal(events.mock.calls.length, 0);
    const authored = state.workingAnimation!;
    const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
    const player = new AnimationPlayer(rig, joints, [compileClip(authored, rig)]);
    const runtimeEvents = vi.fn();
    player.onAnimationEvent(runtimeEvents);
    player.play(authored.name);
    player.pause();
    for (const time of [0, 125, 400, 575, 1000]) {
      player.sample(time, { mode: 'playback' });
      state.setCurrentTime(time / 1000);
      assert.closeTo(
        joints.get('rightForearm')!.pose.rotation,
        state.getEvaluatedBonePropertyValue('rightForearm', 'rotation')!,
        1e-9,
      );
    }
    assert.equal(events.mock.calls.length, 0);
    assert.equal(runtimeEvents.mock.calls.length, 0);
    state.setCurrentTime(0);
    state.play();
    state.advancePlayback(0.35);
    assert.equal(events.mock.calls.length, 1);
    state.pause();
    state.advancePlayback(0.2);
    assert.equal(state.currentTime, 0.35);
    state.setPreviewLoop(true);
    state.setPlaybackSpeed(2);
    state.play();
    state.advancePlayback(0.5);
    assert.closeTo(state.currentTime, 0.35, 1e-9);
    assert.equal(events.mock.calls.length, 2);
    assert.deepEqual(events.mock.calls[0]![0].data, animation.events![0]!.data);
    state.restart();
    assert.equal(state.currentTime, 0);
    state.beginScrub();
    state.setCurrentTime(0.7);
    state.endScrub();
    assert.isTrue(state.isPlaying);
    state.setPreviewLoop(false);
    state.advancePlayback(1);
    assert.equal(state.currentTime, 1);
    assert.isFalse(state.isPlaying);
    assert.strictEqual(state.workingAnimation, authored);
    player.dispose();
  },
);

test.each([undefined, 'linear'] as const)(
  'mirrored JSON with %s interpolation round-trips through imports and CharacterLoader',
  async (interpolation) => {
    const { rig, state, animation } = session({ mode: 'stepped', fps: 17 }, interpolation);
    state.selectKeyframes([0, 0.4, 1].map((time) => ({ boneId: 'leftForearm', property: 'rotation', time })));
    state.mirrorSelectedKeyframes('left-to-right');
    const json = state.exportJson();
    const file: unknown = JSON.parse(json);
    const parsed = parseAnimationClip(file, rig);
    const restored = new AnimationEditorState(rig, [parsed]);
    restored.selectAnimation(parsed.name);
    assert.equal(restored.exportJson(), json);
    assert.deepEqual(Object.keys(file as object).sort(), Object.keys(state.workingAnimation!).sort());
    assert.isFalse(Object.hasOwn(file as object, 'symmetry'));
    assert.isFalse(Object.hasOwn(file as object, 'pairs'));
    assert.deepEqual(parsed.events, animation.events);
    assert.deepEqual(
      parsed.tracks.rightForearm!.map((row) => row.time),
      [0, 400, 1000],
    );
    assert.equal(parsed.interpolation, interpolation);
    const files = new Map<string, unknown>([
      [
        'character.json',
        {
          version: 1,
          id: 'mirrored',
          rig: 'rig.json',
          defaultSkin: 'default',
          skins: { default: 'skin.json' },
          animations: ['animation.json'],
          textures: {},
        },
      ],
      ['rig.json', { version: 1, root: rig.root, bones: rig.bones }],
      ['skin.json', { version: 1, name: 'default', slots: {} }],
      ['animation.json', file],
    ]);
    const character = await CharacterLoader.load('https://example.test/character.json', (input) =>
      Promise.resolve(Response.json(files.get(new URL(requestUrl(input)).pathname.slice(1)))),
    );
    const loaded = character.animations[0]!;
    const before = compileClip(state.workingAnimation!, rig);
    const after = compileClip(loaded, character.rig);
    for (const time of [0, 111, 400, 777, 1000]) {
      const expected = evaluateClip(before, time).get('rightForearm')!.rotation!;
      assert.closeTo(evaluateClip(after, time).get('rightForearm')!.rotation!, expected, 1e-10);
    }
  },
);
