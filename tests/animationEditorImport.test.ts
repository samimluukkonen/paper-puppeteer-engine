import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { getAnimationEventReferences } from '../src/devtools/animation-editor/animationEvents.js';
import { importAnimationJson, verifyAnimationRoundTrip } from '../src/devtools/animation-editor/animationImport.js';
import { serializeAnimation } from '../src/devtools/animation-editor/animationSerialization.js';
import { isFullyFrozen } from '../src/devtools/shared/editorData.js';
import { compileClip } from '../src/engine/AnimationClip.js';
import { evaluateClip } from '../src/engine/AnimationPose.js';
import type { AnimationJsonDefinition, JsonValue } from '../src/engine/externalData.js';
import { Puppet } from '../src/engine/Puppet.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root', x: 2 }] });
function file(): AnimationJsonDefinition {
  return {
    version: 1,
    name: 'imported',
    duration: 1500,
    loop: false,
    interpolation: 'linear',
    playback: { mode: 'stepped', fps: 12.5 },
    tracks: {
      root: [
        { time: 0, x: 3, y: 2 },
        { time: 600, x: 15 },
        { time: 1500, x: 33, rotation: 0.4 },
      ],
      arm: [
        { time: 0, rotation: -0.2 },
        { time: 750, scaleX: -1, rotation: 0.8 },
      ],
    },
    events: [
      { time: 0, name: 'start' },
      { time: 500, name: 'first', data: { nested: [null, true, { value: 0.30000000000000004 }] } },
      { time: 500, name: 'second', data: null },
      { time: 500, name: 'second', data: null },
      { time: 1500, name: 'end' },
    ],
  };
}

test('animation imports enforce configurable keyframe work budgets before replacement', () => {
  const input = JSON.stringify(file());
  const rejected = importAnimationJson(input, rig, { maxKeyframes: 4 });
  assert.isFalse(rejected.success);
  assert.match(rejected.issues[0]!.message, /4-keyframe limit/);
  assert.isTrue(importAnimationJson(input, rig, { maxKeyframes: 5 }).success);
});
function session() {
  const state = new AnimationEditorState(rig, [
    { name: 'old', duration: 2000, loop: true, tracks: { root: [{ time: 0, x: 1 }] } },
  ]);
  state.selectAnimation('old');
  state.setBonePropertyKeyframe('root', 'x', 5);
  state.setBonePropertyKeyframe('root', 'y', 7);
  state.undo(); // Both undo and redo stacks exist before import.
  return state;
}
function snapshot(state: AnimationEditorState) {
  return {
    source: state.sourceAnimation,
    working: state.workingAnimation,
    id: state.selectedAnimationId,
    ids: state.animationIds,
    dirty: state.dirty,
    history: state.historyLength,
    undo: state.canUndo,
    redo: state.canRedo,
    time: state.currentTime,
    playing: state.isPlaying,
    scrubbing: state.isScrubbing,
    keys: state.selectedKeys,
    primary: state.primaryKey,
    event: state.selectedEvent,
    draft: state.boneTransformDraft,
    bone: state.selectedBoneId,
    property: state.selectedTimelineProperty,
    keyDrag: state.keyframeDrag,
    eventDrag: state.eventDrag,
    clipboard: state.timelineClipboard,
  };
}

test('central import validates unknown input and returns a deeply frozen owned snapshot', () => {
  const animation = file();
  const result = importAnimationJson(JSON.stringify(animation), rig);
  assert.isTrue(result.success);
  if (!result.success) return;
  assert.deepEqual(result.data, animation);
  assert.isTrue(isFullyFrozen(result.data));
  animation.tracks.root![0]!.x = 99;
  assert.equal(result.data.tracks.root![0]!.x, 3);
  assert.isFalse(importAnimationJson(JSON.stringify(file())).success);
});

test('compact imports exceeding formatted export capacity retain the active session', () => {
  let data: JsonValue = Array.from({ length: 30_000 }, () => 0);
  for (let depth = 0; depth < 200; depth++) data = { nested: data };
  const animation = { ...file(), events: [{ time: 0, name: 'payload', data }] };
  const json = JSON.stringify(animation);
  assert.isBelow(json.length, 100_000);
  const state = session();
  state.setBonePropertyKeyframe('root', 'x', 99);
  state.play();
  const before = snapshot(state);
  const confirmDiscard = vi.fn(() => true);
  assert.isFalse(state.importJson(json, { confirmDiscard }));
  assert.deepEqual(snapshot(state), before);
  assert.equal(confirmDiscard.mock.calls.length, 0);
  assert.match(state.validationIssues[0]!.message, /size limit/);
  const exported = serializeAnimation(animation, rig);
  assert.isFalse(exported.success);
  if (!exported.success) assert.match(exported.issues[0]!.message, /size limit/);
  assert.isTrue(state.exportAnimation().success);
});

const invalid: [string, () => string, RegExp][] = [
  ['syntax', () => '{broken', /Invalid JSON/],
  ['unknown bone', () => JSON.stringify({ ...file(), tracks: { missing: [{ time: 0, x: 2 }] } }), /missing/],
  [
    'version',
    () => JSON.stringify({ ...file(), version: 99 }),
    /Unsupported animation format version 99.*supported version is 1/,
  ],
  ['missing version', () => JSON.stringify({ ...file(), version: undefined }), /version is required/],
  ['negative time', () => JSON.stringify({ ...file(), tracks: { root: [{ time: -1, x: 1 }] } }), /time/],
  ['out-of-range event', () => JSON.stringify({ ...file(), events: [{ time: 1600, name: 'bad' }] }), /time/],
  [
    'invalid payload',
    () =>
      '{"version":1,"name":"bad","duration":1000,"loop":false,"tracks":{},"events":[{"time":0,"name":"bad","data":1e999}]}',
    /finite|JSON/i,
  ],
  [
    'unsupported field',
    () => JSON.stringify({ ...file(), tracks: { root: [{ time: 0, x: 1, interpolation: 'step' }] } }),
    /Unknown field/,
  ],
  ['null', () => 'null', /version/],
];
for (const [label, json, message] of invalid) {
  test(`rejected ${label} import preserves authored session, history, playback, selection and drafts`, () => {
    const state = session();
    state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
    state.copySelectedKeyframes();
    state.setTemporaryBoneProperty('x', 44);
    state.setCurrentTime(0.4);
    state.play();
    state.beginScrub();
    // Retain a transform draft alongside active scrub intent for the failure boundary.
    state.setTemporaryBoneProperty('x', 44);
    state.play();
    const before = snapshot(state);
    assert.isFalse(state.importJson(json()));
    assert.deepEqual(snapshot(state), before);
    assert.strictEqual(state.workingAnimation, before.working);
    assert.strictEqual(state.sourceAnimation, before.source);
    assert.strictEqual(state.selectedKeys, before.keys);
    assert.strictEqual(state.boneTransformDraft, before.draft);
    assert.match(state.validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'), message);
  });
}

test('successful imports clear previous diagnostics before notifying the fresh session', () => {
  const state = session();
  for (const json of ['{broken', JSON.stringify({ ...file(), version: 99 })]) {
    assert.isFalse(state.importJson(json));
    assert.isAbove(state.validationIssues.length, 0);
    const notified = vi.fn(() => {
      assert.deepEqual(state.validationIssues, []);
      assert.equal(state.selectedAnimationId, 'imported');
      assert.isFalse(state.dirty);
    });
    const release = state.subscribe(notified);
    assert.isTrue(state.importJson(JSON.stringify(file())));
    assert.equal(notified.mock.calls.length, 1);
    release();
    assert.deepEqual(state.validationIssues, []);
  }
});

test.each(['key', 'event', 'scrub', 'draft'] as const)(
  'successful import resets %s transient state with one final notification and no events',
  (kind) => {
    const state = session();
    state.setPreviewLoop(true);
    state.setPlaybackSpeed(2);
    state.setKeyframeSnapMode('frame');
    state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
    state.copySelectedKeyframes();
    const clipboard = state.timelineClipboard;
    if (kind === 'key') {
      state.beginKeyframeDrag(state.primaryKey!);
      state.previewKeyframeDrag(0.6);
    } else if (kind === 'event') {
      state.createAnimationEvent();
      state.beginEventDrag(state.selectedEvent!);
      state.previewEventDrag(0.6);
    } else if (kind === 'scrub') {
      state.setCurrentTime(1.2);
      state.play();
      state.beginScrub();
    } else state.setTemporaryBoneProperty('y', 50);
    const notified = vi.fn(() => {
      assert.equal(state.selectedAnimationId, 'imported');
      assert.equal(state.currentTime, 0);
      assert.isFalse(state.isPlaying);
      assert.isFalse(state.dirty);
    });
    const fired = vi.fn();
    state.subscribe(notified);
    state.onAnimationEvent(fired);
    assert.isTrue(state.importJson(JSON.stringify(file())));
    assert.equal(notified.mock.calls.length, 1);
    assert.equal(fired.mock.calls.length, 0);
    assert.isFalse(state.canUndo);
    assert.isFalse(state.canRedo);
    assert.equal(state.historyLength, 0);
    assert.isFalse(state.isScrubbing);
    assert.isNull(state.keyframeDrag);
    assert.isNull(state.eventDrag);
    assert.deepEqual(state.selectedKeys, []);
    assert.isNull(state.primaryKey);
    assert.isNull(state.selectedEvent);
    assert.isNull(state.selectedBoneId);
    assert.isNull(state.selectedTimelineProperty);
    assert.isFalse(state.hasTemporaryTransform);
    assert.strictEqual(state.timelineClipboard, clipboard);
    assert.isTrue(state.previewLoop);
    assert.equal(state.playbackSpeed, 2);
    assert.equal(state.keyframeSnapMode, 'frame');
    assert.deepEqual(state.workingAnimation, file());
    assert.deepEqual(state.sourceAnimation, file());
    assert.strictEqual(state.sourceAnimation, state.workingAnimation);
    assert.strictEqual(state.sourceAnimation!.tracks, state.workingAnimation!.tracks);
    assert.isTrue(isFullyFrozen(state.sourceAnimation!));
    assert.isTrue(isFullyFrozen(state.workingAnimation!));
    assert.isFalse(state.undo());
  },
);

test('import can start on an empty character, replace the same name, and retains the imported baseline across selection', () => {
  const state = new AnimationEditorState(rig);
  assert.isTrue(state.importJson(JSON.stringify(file())));
  assert.deepEqual(state.animationIds, ['imported']);
  const source = state.sourceAnimation;
  assert.isTrue(state.importJson(JSON.stringify(file())));
  assert.notStrictEqual(state.sourceAnimation, source);
  state.setBonePropertyKeyframe('root', 'x', 100);
  assert.isTrue(state.dirty);
  assert.equal(state.sourceAnimation!.tracks.root![0]!.x, 3);
  state.selectAnimation(null, { discardChanges: true });
  state.selectAnimation('imported');
  assert.isFalse(state.dirty);
  assert.equal(state.workingAnimation!.tracks.root![0]!.x, 3);
});

test.each(['smooth', 'stepped', 'implicit'] as const)(
  'export → import → export preserves canonical JSON and authored %s data',
  (mode) => {
    const state = session();
    const animation = file();
    if (mode === 'smooth') animation.playback = { mode: 'smooth' };
    if (mode === 'implicit') {
      delete animation.playback;
      delete animation.interpolation;
    }
    animation.tracks.root![0]!.x = 0.1 + 0.2;
    assert.isTrue(state.importJson(JSON.stringify(animation)));
    state.setBonePropertyKeyframe('arm', 'y', 9, 0.3);
    const json = state.exportJson();
    const before = state.sourceAnimation;
    assert.isTrue(state.importJson(json));
    assert.equal(state.exportJson(), json);
    assert.notStrictEqual(state.sourceAnimation, before);
    const result = verifyAnimationRoundTrip(state.workingAnimation, rig);
    assert.isTrue(result.success);
    if (result.success) {
      assert.isTrue(result.equivalent);
      assert.equal(result.json, result.reexportedJson);
      assert.equal(result.json, json);
    }
    assert.isFalse(verifyAnimationRoundTrip({ ...file(), version: 99 }, rig).success);
  },
);

test('post-import key, interpolation, event edits and Undo/Redo keep the source isolated and baseline clean', () => {
  const state = session();
  state.importJson(JSON.stringify(file()));
  const source = state.sourceAnimation;
  const baseline = state.exportJson();
  state.setBonePropertyKeyframe('arm', 'y', 9, 0.3);
  state.selectKeyframe({ boneId: 'arm', property: 'y', time: 0.3 });
  state.moveSelectedKeyframe(0.4);
  state.setAuthoredInterpolation(undefined);
  const ref = getAnimationEventReferences(state.workingAnimation)[1]!;
  state.selectAnimationEvent(ref);
  state.updateAnimationEvent(ref, { ...state.selectedEventData!, name: 'changed', data: { changed: true } });
  assert.isTrue(state.dirty);
  assert.deepEqual(source, file());
  const edited = state.exportJson();
  for (let i = 0; i < 4; i++) assert.isTrue(state.undo());
  assert.equal(state.exportJson(), baseline);
  assert.isFalse(state.dirty);
  assert.isFalse(state.undo());
  for (let i = 0; i < 4; i++) assert.isTrue(state.redo());
  assert.equal(state.exportJson(), edited);
  assert.strictEqual(state.sourceAnimation, source);
});

test('reload current export normalizes committed data, discards drafts and resets history without events', () => {
  const state = session();
  const json = state.exportJson();
  state.selectBone('root');
  state.setTemporaryBoneProperty('x', 99);
  const events = vi.fn();
  state.onAnimationEvent(events);
  assert.isTrue(state.reloadCurrentExport());
  assert.equal(state.exportJson(), json);
  assert.isFalse(state.hasTemporaryTransform);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.equal(events.mock.calls.length, 0);
  assert.isFalse(new AnimationEditorState(rig).reloadCurrentExport());
});

test('preview immediately samples the imported clip through the runtime evaluator, including stepped time and restored bind pose', () => {
  const state = session();
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const joints = new Map(rig.bones.map((bone) => [bone.id, puppet.getBone(bone.id)]));
  const syncPose = vi.spyOn(puppet, 'syncPose');
  const preview = new AnimationEditorPreview(state, puppet);
  const events = vi.fn();
  state.onAnimationEvent(events);
  state.importJson(JSON.stringify(file()));
  assert.equal(joints.get('root')!.pose.x, 3);
  assert.equal(joints.get('arm')!.pose.rotation, -0.2);
  const json = state.exportJson();
  const original = joints.get('root')!.pose.x;
  state.setBonePropertyKeyframe('root', 'x', 99);
  assert.equal(joints.get('root')!.pose.x, 99);
  state.importJson(json);
  assert.equal(joints.get('root')!.pose.x, original);
  state.setCurrentTime(0.73);
  const expected = evaluateClip(compileClip(file(), rig), 720); // 12.5 FPS holds 80ms frames.
  assert.approximately(joints.get('root')!.pose.x, expected.get('root')!.x!, 1e-12);
  const before = syncPose.mock.calls.length;
  assert.isFalse(state.importJson('{bad'));
  assert.equal(syncPose.mock.calls.length, before);
  assert.equal(events.mock.calls.length, 0);
  const minimal = { version: 1, name: 'empty', duration: 1000, loop: false, tracks: {} };
  state.importJson(JSON.stringify(minimal));
  assert.equal(joints.get('root')!.pose.x, 0);
  assert.equal(joints.get('arm')!.pose.x, 2);
  preview.dispose();
  puppet.destroy();
});

test('timeline keys and event markers rebuild from imported authored data', () => {
  const state = session();
  state.setTimelineBoneExpanded('root', true);
  const tracks = state.timelineTracks;
  state.importJson(JSON.stringify(file()));
  assert.notStrictEqual(state.timelineTracks, tracks);
  const x = state.timelineTracks.find(
    (track) => track.kind === 'property' && track.boneId === 'root' && track.property === 'x',
  );
  assert.ok(x?.kind === 'property');
  if (x?.kind === 'property')
    assert.deepEqual(
      x.keyframes.map((key) => key.time),
      [0, 0.6, 1.5],
    );
  assert.equal(state.duration, 1.5);
  assert.equal(state.eventTimelineTrack.markers.length, 5);
  assert.equal(state.authoredInterpolation, 'linear');
  assert.equal(state.getSegmentInterpolation({ boneId: 'root', property: 'x', time: 0 })?.mode, 'linear');
  assert.isTrue(serializeAnimation(state.workingAnimation, rig).success);
});
