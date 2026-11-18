import { assert, test, vi } from 'vitest';
import { AnimationEditorDocument } from '../src/devtools/animation-editor/AnimationEditorDocument.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { serializeAnimation } from '../src/devtools/animation-editor/animationSerialization.js';
import { freezeData } from '../src/devtools/shared/editorData.js';
import { compileClip } from '../src/engine/AnimationClip.js';
import { parseAnimationClip, type AnimationJsonDefinition } from '../src/engine/externalData.js';
import { DEFAULT_MAX_JSON_BYTES } from '../src/engine/jsonInput.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }] });
const file = (): AnimationJsonDefinition => ({
  version: 1,
  name: 'move',
  duration: 1000,
  loop: true,
  interpolation: 'linear',
  playback: { mode: 'stepped', fps: 12.5 },
  tracks: {
    root: [
      { time: 0, y: 2, x: 1 },
      { time: 500, rotation: 0.3 },
      { time: 1000, x: 4 },
    ],
    arm: [{ time: 250, scaleY: -1, rotation: 0.2 }],
  },
  events: [
    { time: 750, name: 'end' },
    { time: 250, name: 'first', data: { z: [null, true, { z: 'last', a: 0.30000000000000004 }], a: 2 } },
    { time: 250, name: 'second', data: null },
    { time: 250, name: 'second', data: null },
  ],
});

function exported(input: unknown = file()) {
  const result = serializeAnimation(input, rig);
  if (!result.success) throw new Error(result.issues.map((issue) => issue.message).join('\n'));
  return result;
}

test('canonical JSON is stable across repeated exports and object insertion order', () => {
  const animation = file();
  const first = exported(animation);
  assert.equal(exported(animation).json, first.json);
  const reordered = {
    ...animation,
    tracks: {
      arm: animation.tracks.arm,
      root: animation.tracks.root!.map((key) => Object.fromEntries(Object.entries(key).reverse())),
    },
    events: animation.events!.map((event) => ({
      ...event,
      ...(event.data && typeof event.data === 'object' && !Array.isArray(event.data)
        ? { data: Object.fromEntries(Object.entries(event.data).reverse()) }
        : {}),
    })),
  };
  assert.equal(exported(reordered).json, first.json);
  assert.deepEqual(Object.keys(first.data), [
    'version',
    'name',
    'duration',
    'loop',
    'interpolation',
    'playback',
    'tracks',
    'events',
  ]);
  assert.deepEqual(Object.keys(first.data.tracks), ['arm', 'root']);
  assert.deepEqual(Object.keys(first.data.tracks.root![0]!), ['time', 'x', 'y']);
  assert.match(first.json, /^\{\n  "version": 1,/);
  assert.isTrue(first.json.endsWith('\n'));
  // Raw serialized output remains accepted by the same parser used by CharacterLoader.
  const loaded = parseAnimationClip(JSON.parse(first.json), rig);
  assert.deepEqual(loaded.tracks, animation.tracks);
  assert.deepEqual(compileClip(loaded, rig).events, compileClip(animation, rig).events);
});

test('loading and exports reject documents that would exceed the importer byte limit', () => {
  const animation: AnimationJsonDefinition = {
    version: 1,
    name: 'large',
    duration: 1000,
    loop: false,
    tracks: {},
    events: [{ time: 0, name: 'event', data: 'a'.repeat(DEFAULT_MAX_JSON_BYTES) }],
  };
  const stringify = vi.spyOn(JSON, 'stringify');
  const result = serializeAnimation(animation, rig);
  assert.isFalse(
    stringify.mock.calls.some((args) => args[2] === 2),
    'Reject before formatting the entire document.',
  );
  stringify.mockRestore();
  assert.isFalse(result.success);
  assert.match(result.issues[0]!.message, /byte size limit/);
  const state = new AnimationEditorState(rig, [animation]);
  assert.isFalse(state.selectAnimation('large'));
  assert.match(state.validationIssues[0]!.message, /byte size limit/);
  assert.isNull(state.workingAnimation);
  assert.equal(state.historyLength, 0);
});

test('key edits cannot push an exportable document past the shared export budget', () => {
  const input: AnimationJsonDefinition = {
    version: 1,
    name: 'large',
    duration: 1000,
    loop: false,
    tracks: {},
    events: [{ time: 0, name: 'data', data: '' }],
  };
  const overhead = new TextEncoder().encode(`${JSON.stringify(input, null, 2)}\n`).byteLength;
  input.events![0]!.data = 'x'.repeat(DEFAULT_MAX_JSON_BYTES - overhead - 100);
  const state = new AnimationEditorState(rig);
  assert.isTrue(state.importJson(JSON.stringify(input)));
  assert.isTrue(state.exportAnimation().success);
  assert.isTrue(state.keyframes.setBonePropertyKeyframe('root', 'x', 1, 0));
  const working = state.workingAnimation;
  const history = state.historyLength;
  assert.isFalse(state.keyframes.setBonePropertyKeyframe('root', 'x', 2, 0.1));
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, history);
  assert.match(state.validationIssues[0]!.message, /byte size limit/);
  assert.isTrue(state.exportAnimation().success);
  assert.isTrue(state.undo());
  assert.isTrue(state.redo());
  assert.strictEqual(state.workingAnimation, working);
});

test('direct replacement cannot bypass the document export budget or change history', () => {
  const state = new AnimationEditorState(rig, [file()]);
  state.selectAnimation('move');
  const working = state.workingAnimation;
  assert.isFalse(
    state.replaceWorkingAnimation({
      ...working,
      events: [{ time: 0, name: 'data', data: 'é'.repeat(DEFAULT_MAX_JSON_BYTES / 2) }],
    }),
  );
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.match(state.validationIssues[0]!.message, /byte size limit/);
});

test('partial tracks, event payloads, duplicate same-time events and interpolation remain authored data', () => {
  const animation = file();
  const data = exported(animation).data;
  assert.deepEqual(data.tracks, animation.tracks);
  assert.equal(data.interpolation, 'linear');
  assert.deepEqual(data.playback, animation.playback);
  assert.equal(data.duration, animation.duration);
  assert.equal(data.loop, animation.loop);
  assert.deepEqual(
    data.events,
    [...animation.events!].sort((a, b) => a.time - b.time),
  );
  assert.deepEqual(
    data.events!.map((event) => event.name),
    ['first', 'second', 'second', 'end'],
  );
  assert.isFalse(Object.hasOwn(data.events![3]!, 'data'));
  const omitted = { ...animation };
  delete omitted.events;
  delete omitted.playback;
  delete omitted.interpolation;
  const minimal = exported(omitted).data;
  for (const key of ['events', 'playback', 'interpolation']) assert.isFalse(Object.hasOwn(minimal, key));
  assert.deepEqual(exported({ ...omitted, tracks: {}, events: [] }).data.tracks, {});
});

test('float cleanup removes arithmetic noise without rounding high precision or payload numbers', () => {
  const animation = file();
  animation.duration = 0.1 + 0.2;
  animation.tracks = {
    root: [
      { time: 0, x: 0.1 + 0.2, y: 1 / 3, rotation: -0.1 - 0.2, scaleX: 1e-12, scaleY: 1.0000000000000002 },
      { time: 0.1 + 0.2, x: 1.23456789 },
    ],
  };
  animation.events = [{ time: 0.1 + 0.2, name: 'end', data: { value: 0.1 + 0.2 } }];
  animation.playback = { mode: 'stepped', fps: 10.000000000000002 };
  const before = structuredClone(animation);
  const data = exported(animation).data;
  assert.equal(data.duration, 0.3);
  assert.deepEqual(data.tracks.root, [
    { time: 0, x: 0.3, y: 1 / 3, rotation: -0.3, scaleX: 1e-12, scaleY: 1 },
    { time: 0.3, x: 1.23456789 },
  ]);
  assert.deepEqual(data.events, [{ time: 0.3, name: 'end', data: { value: 0.30000000000000004 } }]);
  assert.deepEqual(data.playback, { mode: 'stepped', fps: 10 });
  assert.deepEqual(animation, before);
});

test('normalization retains distinct close times and positive durations without FPS quantization', () => {
  const animation = file();
  animation.tracks = {
    root: [
      { time: 0.3, x: 1 },
      { time: 0.30000000000000004, x: 2 },
      { time: 123.456789123, x: 3 },
    ],
  };
  animation.events = [
    { time: 0.3, name: 'a' },
    { time: 0.30000000000000004, name: 'b' },
  ];
  const data = exported(animation).data;
  assert.deepEqual(data.tracks, animation.tracks);
  assert.deepEqual(data.events, animation.events);
  assert.equal(exported({ ...animation, duration: 1e-12, tracks: {}, events: [] }).data.duration, 1e-12);
});

test('export does not mutate source, working copy, input or any editor session state', () => {
  const animation = file();
  const original = structuredClone(animation);
  const state = new AnimationEditorState(rig, [animation]);
  state.selectAnimation('move');
  state.keyframes.setBonePropertyKeyframe('root', 'x', 0.1 + 0.2, 0);
  state.selectBone('root');
  state.setCurrentTime(0.25);
  state.selectKeyframe({ boneId: 'arm', property: 'rotation', time: 0.25 });
  state.keyframes.copySelectedKeyframes();
  state.setTemporaryBoneProperty('y', 99);
  state.playback.setPreviewLoop(false);
  state.playback.setPlaybackSpeed(2);
  const source = state.sourceAnimation;
  const working = state.workingAnimation;
  const workingData = structuredClone(working);
  const baseline = {
    history: state.historyLength,
    dirty: state.dirty,
    time: state.currentTime,
    selection: state.selectedKeys,
    clipboard: state.timelineClipboard,
    draft: state.boneTransformDraft,
    issues: state.validationIssues,
    playing: state.playback.isPlaying,
  };
  const notify = vi.fn();
  state.subscribe(notify);
  const result = state.exportAnimation();
  assert.isTrue(result.success);
  if (!result.success) return;
  assert.equal(result.json, state.exportJson());
  assert.strictEqual(state.sourceAnimation, source);
  assert.strictEqual(state.workingAnimation, working);
  assert.deepEqual(state.workingAnimation, workingData);
  assert.deepEqual(animation, original);
  assert.deepEqual(source, original);
  assert.deepEqual(
    {
      history: state.historyLength,
      dirty: state.dirty,
      time: state.currentTime,
      selection: state.selectedKeys,
      clipboard: state.timelineClipboard,
      draft: state.boneTransformDraft,
      issues: state.validationIssues,
      playing: state.playback.isPlaying,
    },
    baseline,
  );
  assert.equal(notify.mock.calls.length, 0);
  assert.equal(state.playback.playbackSpeed, 2);
  assert.isFalse(state.playback.previewLoop);
  assert.deepEqual(Object.keys(JSON.parse(result.json) as object), Object.keys(file()));
  result.data.tracks = {};
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.exportJson(), result.json, 'returned export data is independently owned');
});

test('validation rejects invalid authored data before serialization instead of silently repairing it', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const invalid: unknown[] = [
    { ...file(), version: 2 },
    { ...file(), currentTime: 0 },
    { ...file(), duration: NaN },
    { ...file(), playback: { mode: 'stepped', fps: 0 } },
    { ...file(), tracks: { missing: [] } },
    { ...file(), tracks: { root: [{ time: 500 }, { time: 0 }] } },
    { ...file(), tracks: { root: [{ time: 0.3 }, { time: 0.3 }] } },
    { ...file(), events: [{ time: 1001, name: 'past-end' }] },
    ...[undefined, () => {}, new Map(), new Set(), new Date(), cyclic, Infinity].map((data) => ({
      ...file(),
      events: [{ time: 0, name: 'bad-payload', data }],
    })),
  ];
  for (const input of invalid) {
    const result = serializeAnimation(input, rig);
    assert.isFalse(result.success);
    assert.isNotEmpty(result.issues);
    assert.isFalse(Object.hasOwn(result, 'json'));
    assert.isFalse(Object.hasOwn(result, 'data'));
  }
});

test('document export reports invalid snapshots without changing validation, history or dirty state', () => {
  const document = new AnimationEditorDocument(rig, [file()]);
  document.selectAnimation('move');
  // Simulate an internal edit bug; export must still validate independently.
  document.install(freezeData({ ...file(), playback: { mode: 'stepped', fps: 0 } }));
  const working = document.workingAnimation;
  const issues = document.validationIssues;
  assert.isFalse(document.exportAnimation().success);
  assert.throws(() => document.exportJson(), /playback.fps/);
  assert.strictEqual(document.workingAnimation, working);
  assert.strictEqual(document.validationIssues, issues);
  assert.equal(document.historyLength, 1);
  assert.isTrue(document.dirty);
  assert.isFalse(new AnimationEditorState().exportAnimation().success);
});
