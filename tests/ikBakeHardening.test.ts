import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { createBoneSymmetryMapping, inferBoneSymmetryPairs } from '../src/devtools/shared/boneSymmetry.js';
import {
  type AnimationClip,
  CharacterLoader,
  commitIKBake,
  compareIKBakeMotion,
  compileClip,
  evaluateClip,
  generateBakedBoneKeys,
  parseAnimationClip,
  Rig,
  sampleIKBake,
} from '../src/engine/core.js';
import { Puppet } from '../src/engine/Puppet.js';
import { puppetScene } from './helpers/puppetScene.js';
import { requestUrl } from './helpers/requestUrl.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture(playback: AnimationClip['playback'] = { mode: 'smooth' }, transformedParent = true) {
  const rig = new Rig({
    root: 'body',
    bones: [
      {
        id: 'body',
        x: 10,
        y: -5,
        rotation: transformedParent ? 0.3 : 0,
        scaleX: transformedParent ? 1.2 : 1,
        scaleY: transformedParent ? 0.8 : 1,
      },
      ...(['left', 'right'] as const).flatMap((side) => [
        { id: `${side}UpperArm`, parent: 'body', x: side === 'left' ? -10 : 10 },
        { id: `${side}Forearm`, parent: `${side}UpperArm`, y: 60 },
        { id: `${side}Hand`, parent: `${side}Forearm`, y: 40 },
      ]),
    ],
    ik: (['left', 'right'] as const).map((side) => ({
      name: side,
      rootBone: `${side}UpperArm`,
      middleBone: `${side}Forearm`,
      endBone: `${side}Hand`,
      endOffset: { x: 2, y: 3 },
      bendDirection: side === 'left' ? 1 : -1,
    })),
  });
  const source: AnimationClip = {
    name: 'reach',
    duration: 1050,
    loop: false,
    playback,
    tracks: {
      leftUpperArm: [{ time: 0, rotation: 0.2 }],
      leftForearm: [{ time: 0, rotation: 0.3 }],
    },
    ikTracks: {
      left: [
        { time: 0, x: 40, y: 60, mix: 1 },
        { time: 1050, x: -35, y: 75, mix: 1 },
      ],
      right: [
        { time: 0, x: -20, y: 85 },
        { time: 1050, x: 40, y: 55 },
      ],
    },
    events: [
      { time: 0, name: 'start' },
      { time: 500, name: 'contact', data: { hand: 'left', nested: [1, { enabled: true }] } },
      { time: 1050, name: 'end' },
    ],
  };
  return { rig, source };
}

function bake(source: AnimationClip, rig: Rig, fps = 10, ids = ['left']) {
  const samples = sampleIKBake(source, rig, ids, { fps });
  const plan = generateBakedBoneKeys(samples, rig, {
    animation: source,
    outputMode: source.playback?.mode ?? 'smooth',
  });
  assert.isTrue(plan.success, JSON.stringify(plan.issues));
  const result = commitIKBake(source, plan, rig);
  assert.isTrue(result.success, JSON.stringify(result.issues));
  if (!result.success) throw new Error('Bake failed');
  return result;
}

for (const fps of [8, 10, 12, 60]) {
  test.each(['smooth', 'stepped'] as const)(
    `${fps} FPS $0 bake preserves duration and reports key/midpoint/end fidelity`,
    (mode) => {
      const { source, rig } = fixture(mode === 'stepped' ? { mode, fps } : { mode });
      const before = JSON.stringify(source);
      const result = bake(source, rig, fps);
      const report = result.motionFidelity;
      assert.isTrue(report.success);
      assert.isAtMost(report.atKeys.rotation, 1e-6);
      assert.isAtMost(report.atKeys.endEffector, 1e-5);
      assert.equal(result.animation.duration, 1050);
      assert.deepEqual(result.animation.playback, source.playback);
      assert.equal(report.probes[0]!.time, 0);
      assert.equal(report.probes.at(-1)!.time, 1050);
      assert.isTrue(report.probes.some((probe) => probe.phase === 'between' && probe.time > 1049));
      const times = report.probes.filter((probe) => probe.phase === 'key').map((probe) => probe.time);
      assert.deepEqual(
        times,
        result.animation.tracks.leftUpperArm!.map((key) => key.time),
      );
      assert.isTrue(report.probes.some((probe) => probe.time === 500 / fps && probe.phase === 'between'));
      if (mode === 'stepped') assert.isAtMost(report.betweenKeys.endEffector, 1e-5);
      assert.deepEqual(report, compareIKBakeMotion(source, result.animation, rig, ['left'], fps));
      assert.deepEqual(result, bake(source, rig, fps));
      assert.isTrue(Object.isFrozen(report.probes[0]!.errors));
      assert.equal(JSON.stringify(source), before);
    },
  );
}

test('low sampling frequency reports missed nonlinear motion instead of claiming fidelity', () => {
  const { source, rig } = fixture();
  source.ikTracks = {
    ...source.ikTracks,
    left: [
      { time: 0, x: 40, y: 60 },
      { time: 50, x: -40, y: 60 },
      { time: 100, x: 40, y: 60 },
      { time: 1050, x: 40, y: 60 },
    ],
  };
  const low = bake(source, rig, 10).motionFidelity;
  const high = bake(source, rig, 60).motionFidelity;
  assert.isTrue(low.success, 'key-time equality is independent of midpoint quality');
  assert.isFalse(low.withinBetweenKeyTolerance);
  assert.isAbove(low.betweenKeys.endEffector, 50);
  assert.isTrue(
    low.issues.some((issue) => issue.severity === 'warning' && issue.message.includes('Increase sampling FPS')),
  );
  assert.isBelow(high.betweenKeys.endEffector, low.betweenKeys.endEffector / 10);
});

test.each([0, 0.4, 1, 'changing', 'unreachable', 'targetless'] as const)(
  'finite baked runtime transforms for IK edge case %s',
  (mode) => {
    const { source, rig } = fixture();
    if (mode === 'targetless') source.ikTracks = { right: source.ikTracks!.right! };
    else
      source.ikTracks = {
        ...source.ikTracks,
        left: [
          { time: 0, x: mode === 'unreachable' ? 1000 : 40, y: 60, mix: typeof mode === 'number' ? mode : 0 },
          { time: 1050, x: mode === 'unreachable' ? -1000 : -35, y: 75, mix: typeof mode === 'number' ? mode : 1 },
        ],
      };
    const result = bake(source, rig, 12, ['left', 'right']);
    assert.isTrue(result.motionFidelity.success);
    for (const keys of Object.values(result.animation.tracks))
      for (const key of keys) assert.isTrue(Object.values(key).every(Number.isFinite));
    assert.deepEqual(result.animation.disabledIKConstraints, ['left', 'right']);
  },
);

test('invalid references, duration, sampling and undeactivated candidates produce structured failure', () => {
  const { source, rig } = fixture();
  const result = bake(source, rig);
  for (const report of [
    compareIKBakeMotion(source, source, rig, ['left'], 10),
    compareIKBakeMotion(source, result.animation, rig, ['missing'], 10),
    compareIKBakeMotion(source, result.animation, rig, [], 10),
    compareIKBakeMotion(source, result.animation, rig, ['left', 'left'], 10),
    compareIKBakeMotion(source, result.animation, rig, ['left'], 0),
    compareIKBakeMotion(source, { ...result.animation, duration: 1200 }, rig, ['left'], 10),
  ]) {
    assert.isFalse(report.success);
    assert.isTrue(report.issues.some((issue) => issue.severity === 'error'));
  }
  const zero = sampleIKBake({ ...source, duration: 0, tracks: {}, ikTracks: {}, events: [] }, rig, ['left']);
  assert.isFalse(zero.success);
  const bad = sampleIKBake({ ...source, ikTracks: { missing: [{ time: 0, x: 1 }] } }, rig, ['left']);
  assert.isFalse(bad.success);
  const corrupted = {
    ...result.animation,
    tracks: { ...result.animation.tracks, leftForearm: [{ time: 0, rotation: 0 }] },
  };
  assert.isFalse(compareIKBakeMotion(source, corrupted, rig, ['left'], 10).success);
});

test('unsupported transforms hidden between generated keys fail atomically rather than escaping sampling checks', () => {
  const { source, rig } = fixture();
  source.tracks = {
    ...source.tracks,
    leftUpperArm: [
      { time: 0, scaleX: 1, scaleY: 1 },
      { time: 50, scaleX: 2, scaleY: 1 },
      { time: 100, scaleX: 1, scaleY: 1 },
      { time: 1050, scaleX: 1, scaleY: 1 },
    ],
  };
  const samples = sampleIKBake(source, rig, ['left'], { fps: 10 });
  assert.isTrue(samples.success);
  const plan = generateBakedBoneKeys(samples, rig, { animation: source, outputMode: 'smooth' });
  assert.isTrue(plan.success);
  const state = new AnimationEditorState(rig, [source]);
  state.selectAnimation('reach');
  const original = state.workingAnimation;
  assert.isFalse(state.commitIKBake(plan));
  assert.isTrue(state.validationIssues.some((issue) => issue.message.includes('50 ms: unsupported-scale')));
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
});

test.each(['left', 'right'] as const)(
  'actual Puppet key motion matches under %s facing and nonuniform outer scale',
  (facing) => {
    const { source, rig } = fixture();
    const result = bake(source, rig, 12);
    const original = new Puppet(puppetScene(), { rig, animations: [source], autoUpdate: false });
    const baked = new Puppet(puppetScene(), { rig, animations: [result.animation], autoUpdate: false });
    for (const puppet of [original, baked]) {
      puppet.container.setPosition(400, 250).setRotation(-0.2).setScale(2, 0.6);
      puppet.setFacing(facing);
      puppet.play('reach');
    }
    for (const probe of result.motionFidelity.probes) {
      original.sampleAnimation(probe.time, { mode: 'playback' });
      baked.sampleAnimation(probe.time, { mode: 'playback' });
      const point = (puppet: Puppet) =>
        puppet.getBone('leftHand').container.getWorldTransformMatrix().transformPoint(2, 3);
      const a = point(original),
        b = point(baked);
      assert.isAtMost(Math.hypot(a.x - b.x, a.y - b.y), 2 * probe.errors.endEffector + 1e-8);
      if (probe.phase === 'key') assert.isAtMost(Math.hypot(a.x - b.x, a.y - b.y), 1e-5);
      assert.equal(baked.getIK('left').status, 'inactive');
      assert.equal(baked.getIK('right').status, original.getIK('right').status);
    }
    original.destroy();
    baked.destroy();
  },
);

test('ordinary baked keys support group edit/clipboard/duplicate/delete/interpolation with immutable history', () => {
  const { source, rig } = fixture();
  const state = new AnimationEditorState(rig, [source]);
  state.selectAnimation('reach');
  const original = state.workingAnimation;
  const sourceJson = JSON.stringify(source);
  const plan = generateBakedBoneKeys(sampleIKBake(source, rig, ['left']), rig, {
    animation: source,
    outputMode: 'smooth',
  });
  assert.isTrue(state.commitIKBake(plan));
  const snapshots = [original, state.workingAnimation];
  state.selectKeyframes(['leftUpperArm', 'leftForearm'].map((boneId) => ({ boneId, property: 'rotation', time: 0.2 })));
  assert.isTrue(state.keyframes.moveSelectedKeyframe(0.25));
  snapshots.push(state.workingAnimation);
  assert.deepEqual(
    state.selectedKeys.map((key) => key.time),
    [0.25, 0.25],
  );
  assert.isTrue(state.keyframes.copySelectedKeyframes());
  state.setCurrentTime(0.45);
  assert.isTrue(state.keyframes.pasteKeyframes());
  snapshots.push(state.workingAnimation);
  assert.isTrue(state.keyframes.duplicateSelectedKeyframes());
  snapshots.push(state.workingAnimation);
  assert.isTrue(state.keyframes.setBonePropertyKeyframe('leftForearm', 'rotation', 0.75, 0.45));
  snapshots.push(state.workingAnimation);
  assert.isTrue(state.deleteSelectedKeyframes());
  snapshots.push(state.workingAnimation);
  assert.isTrue(state.setAuthoredInterpolation('linear'));
  snapshots.push(state.workingAnimation);
  for (let index = snapshots.length - 2; index >= 0; --index) {
    assert.isTrue(state.undo());
    assert.strictEqual(state.workingAnimation, snapshots[index]);
  }
  assert.isFalse(state.dirty);
  for (const snapshot of snapshots.slice(1)) {
    assert.isTrue(state.redo());
    assert.strictEqual(state.workingAnimation, snapshot);
    assert.deepEqual(state.workingAnimation!.disabledIKConstraints, ['left']);
    assert.deepEqual(state.workingAnimation!.events, source.events);
  }
  assert.strictEqual(state.sourceAnimation, original);
  assert.equal(JSON.stringify(source), sourceJson);
});

test('onion poses refresh after bake/edit/undo; mirroring preserves IK tracks and clip suppression', () => {
  const { source, rig } = fixture({ mode: 'smooth' }, false);
  const state = new AnimationEditorState(rig, [source]);
  state.selectAnimation('reach');
  state.setCurrentTime(0.5);
  const event = vi.fn();
  state.playback.onAnimationEvent(event);
  const before = state.sampleGhostPose(0.4)!.get('leftForearm')!.rotation;
  const plan = generateBakedBoneKeys(sampleIKBake(source, rig, ['left']), rig, {
    animation: source,
    outputMode: 'smooth',
  });
  assert.isTrue(state.commitIKBake(plan));
  const authored = state.workingAnimation!;
  const ghosts = state.sampleGhostPoses({ previousCount: 3, nextCount: 3 });
  assert.lengthOf(ghosts, 6);
  assert.notEqual(ghosts[0]!.pose.get('leftForearm')!.rotation, before);
  for (const ghost of ghosts) assert.deepEqual(ghost.pose, state.sampleGhostPose(ghost.time));
  assert.isTrue(state.keyframes.setBonePropertyKeyframe('leftForearm', 'rotation', 0.7, 0.4));
  assert.closeTo(state.sampleGhostPose(0.4)!.get('leftForearm')!.rotation!, 0.7, 1e-12);
  state.undo();
  assert.strictEqual(state.workingAnimation, authored);
  const mapping = createBoneSymmetryMapping(rig, { automaticCandidates: inferBoneSymmetryPairs(rig).pairs });
  assert.isTrue(mapping.success);
  state.setSymmetryMapping(mapping.mapping);
  state.selectKeyframes([{ boneId: 'leftForearm', property: 'rotation', time: 0.4 }]);
  assert.isTrue(state.keyframes.mirrorSelectedKeyframes('left-to-right'));
  assert.isDefined(state.findBonePropertyKeyframe('rightForearm', 'rotation', 0.4));
  assert.deepEqual(state.workingAnimation!.ikTracks, authored.ikTracks);
  assert.deepEqual(state.workingAnimation!.disabledIKConstraints, ['left']);
  assert.equal(event.mock.calls.length, 0);
  state.undo();
  state.undo();
  assert.equal(state.sampleGhostPose(0.4)!.get('leftForearm')!.rotation, before);
});

test('bake/edit/undo/undo/redo/export/import/revert preserves source and canonical JSON through CharacterLoader', async () => {
  const { source, rig } = fixture();
  const state = new AnimationEditorState(rig, [source]);
  state.selectAnimation('reach');
  const original = state.sourceAnimation;
  const originalJson = JSON.stringify(original);
  const plan = generateBakedBoneKeys(sampleIKBake(source, rig, ['left']), rig, {
    animation: source,
    outputMode: 'smooth',
  });
  assert.isTrue(state.commitIKBake(plan));
  const baked = state.workingAnimation;
  state.keyframes.setBonePropertyKeyframe('leftForearm', 'rotation', 0.5, 0.5);
  state.undo();
  assert.strictEqual(state.workingAnimation, baked);
  state.undo();
  assert.strictEqual(state.workingAnimation, original);
  assert.isFalse(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, baked);
  const json = state.exportJson();
  assert.notInclude(json, 'motionFidelity');
  const restored = new AnimationEditorState(rig, [parseAnimationClip(JSON.parse(json), rig)]);
  restored.selectAnimation('reach');
  for (let count = 0; count < 3; ++count) {
    assert.equal(restored.exportJson(), json);
    assert.isTrue(restored.importJson(json, { confirmDiscard: () => true }));
  }
  assert.isTrue(state.importJson(json, { confirmDiscard: () => true }));
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  state.keyframes.setBonePropertyKeyframe('leftForearm', 'rotation', 0.9, 0.5);
  assert.isTrue(state.revertAnimation({ discardChanges: true }));
  assert.equal(state.exportJson(), json);
  assert.isFalse(state.dirty);
  assert.equal(JSON.stringify(original), originalJson);
  const files = new Map<string, unknown>([
    [
      'character.json',
      {
        version: 1,
        id: 'baked',
        rig: 'rig.json',
        defaultSkin: 'default',
        skins: { default: 'skin.json' },
        animations: ['animation.json'],
        textures: {},
      },
    ],
    ['rig.json', { version: 1, root: rig.root, bones: rig.bones, ik: rig.ik }],
    ['skin.json', { version: 1, name: 'default', slots: {} }],
    ['animation.json', JSON.parse(json) as unknown],
  ]);
  const character = await CharacterLoader.load('https://example.test/character.json', (input) =>
    Promise.resolve(Response.json(files.get(new URL(requestUrl(input)).pathname.slice(1)))),
  );
  const puppet = new Puppet(puppetScene(), { definition: character, autoUpdate: false });
  puppet.play('reach');
  for (const time of [0, 50, 500, 1049, 1050]) {
    puppet.sampleAnimation(time, { mode: 'playback' });
    const pose = evaluateClip(compileClip(restored.workingAnimation!, rig), time);
    assert.closeTo(puppet.getBone('leftForearm').pose.rotation, pose.get('leftForearm')!.rotation!, 1e-9);
    assert.equal(puppet.getIK('left').status, 'inactive');
  }
  puppet.destroy();
});

test.each([0.5, 1, 2])('baked playback at speed %s preserves events, pause/resume/restart/loop/completion', (speed) => {
  const { source, rig } = fixture();
  const animation = bake(source, rig).animation;
  const reference = new Puppet(puppetScene(), { rig, animations: [source], autoUpdate: false });
  const puppet = new Puppet(puppetScene(), {
    rig,
    animations: [animation, { ...animation, name: 'loop', loop: true }],
    autoUpdate: false,
  });
  const events = vi.fn(),
    expectedEvents = vi.fn(),
    complete = vi.fn();
  puppet.onAnimationEvent(events);
  reference.onAnimationEvent(expectedEvents);
  puppet.onAnimationComplete(complete);
  for (const value of [puppet, reference]) {
    value.setAnimationSpeed(speed);
    value.play('reach');
  }
  puppet.pauseAnimation();
  puppet.update(500);
  assert.equal(puppet.posePipeline.player.elapsedTime, 0);
  puppet.resumeAnimation();
  for (const delta of [250 / speed, 250 / speed, 550 / speed]) {
    puppet.update(delta);
    reference.update(delta);
  }
  assert.deepEqual(events.mock.calls, expectedEvents.mock.calls);
  assert.deepEqual(
    events.mock.calls.map(([event]) => (event as { name: string }).name),
    ['start', 'contact', 'end'],
  );
  assert.equal(complete.mock.calls.length, 1);
  assert.equal(puppet.posePipeline.player.elapsedTime, 1050);
  puppet.sampleAnimation(500);
  assert.equal(events.mock.calls.length, 3);
  puppet.play('loop', { restart: true });
  puppet.update(2100 / speed);
  assert.equal(puppet.posePipeline.player.elapsedTime, 0);
  assert.equal(complete.mock.calls.length, 1);
  assert.equal(puppet.getIK('left').status, 'inactive');
  puppet.destroy();
  reference.destroy();
});
