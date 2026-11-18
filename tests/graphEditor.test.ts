import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  constrainGraphHandle,
  DEFAULT_GRAPH_CURVE,
  editGraphKey,
  fitGraph,
  graphChannels,
  graphDisplayKeys,
  graphKeys,
  graphToPoint,
  panGraph,
  pointToGraph,
  sampleGraph,
  selectedGraphChannel,
  zoomGraph,
  type GraphChannel,
} from '../src/devtools/animation-editor/graphEditor.js';
import { compileClip, sampleProperty } from '../src/engine/AnimationClip.js';
import { evaluateClip } from '../src/engine/AnimationPose.js';
import { evaluateIKClip } from '../src/engine/ik/AnimationIKPose.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
const rig = new Rig({
  root: 'root',
  bones: [{ id: 'root' }, { id: 'middle', parent: 'root', x: 10 }, { id: 'end', parent: 'middle', x: 10 }],
  ik: [{ name: 'arm', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
});
const x: GraphChannel = { kind: 'bone', id: 'root', property: 'x' };
const mix: GraphChannel = { kind: 'ik', id: 'arm', property: 'mix' };
const ref = { channel: x, time: 0 };
function fixture() {
  const state = new AnimationEditorState(rig, [
    {
      name: 'graph',
      duration: 1000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: -10, y: 3, rotation: (170 * Math.PI) / 180 },
          { time: 500, x: 0 },
          { time: 1000, x: 10, y: 5, rotation: (-170 * Math.PI) / 180 },
        ],
      },
      ikTracks: {
        arm: [
          { time: 0, x: 10, y: 10, mix: 0 },
          { time: 1000, x: 15, y: 5, mix: 1 },
        ],
      },
    },
  ]);
  state.selectAnimation('graph');
  state.selectTimelineProperty('root', 'x');
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  return state;
}
test('property selection exposes exactly supported channels and follows the shared timeline target', () => {
  const state = fixture();
  assert.deepEqual(
    graphChannels(state).map((channel) => channel.property),
    ['x', 'y', 'rotation', 'scaleX', 'scaleY'],
  );
  state.selectTimelineProperty('root', 'rotation');
  assert.equal(selectedGraphChannel(state)?.property, 'rotation');
  state.ik.selectIKConstraint('arm', 'mix');
  assert.deepEqual(
    graphChannels(state).map((channel) => channel.property),
    ['x', 'y', 'mix'],
  );
  assert.deepEqual(selectedGraphChannel(state), mix);
  state.selectBone(null);
  assert.deepEqual(graphChannels(state), []);
});
test('graph samples use the runtime evaluator for every supported outgoing mode', () => {
  for (const curve of [{ mode: 'linear' } as const, { mode: 'stepped' } as const, DEFAULT_GRAPH_CURVE]) {
    const state = fixture();
    state.graph.editGraphKey(ref, { curve });
    const animation = state.workingAnimation!;
    const keys = graphDisplayKeys(animation, x);
    const clip = compileClip(animation, rig);
    for (const time of [0, 0.01, 0.13, 0.25, 0.499, 0.5, 0.75, 1])
      assert.closeTo(sampleGraph(animation, keys, time), evaluateClip(clip, time * 1000).get('root')!.x!, 1e-12);
  }
});
test('graph respects authored frame holds and exact clip endpoint', () => {
  const state = fixture();
  state.playback.setAuthoredPlaybackMode('stepped');
  state.playback.setAuthoredFPS(2);
  const animation = state.workingAnimation!;
  const keys = graphDisplayKeys(animation, x);
  assert.equal(sampleGraph(animation, keys, 0.49), -10);
  assert.equal(sampleGraph(animation, keys, 0.5), 0);
  assert.equal(sampleGraph(animation, keys, 1), 10);
});
test('rotation graph unwraps degrees without changing authored radians or shortest-path playback', () => {
  const state = fixture();
  const channel = { kind: 'bone', id: 'root', property: 'rotation' } as const;
  const animation = state.workingAnimation!;
  const keys = graphDisplayKeys(animation, channel);
  assert.closeTo(keys[0]!.value, 170, 1e-10);
  assert.closeTo(keys[1]!.value, 190, 1e-10);
  for (const time of [0.25, 0.5, 0.999])
    assert.closeTo(
      (sampleGraph(animation, keys, time) * Math.PI) / 180,
      sampleProperty(graphKeys(animation, channel), time * 1000, 'rotation'),
      1e-10,
    );
  assert.closeTo(graphKeys(animation, channel)[1]!.value, (-170 * Math.PI) / 180, 1e-12);
});
test('sparse key movement preserves sibling values, controls and unrelated branches', () => {
  const state = fixture();
  state.graph.editGraphKey(ref, { curve: DEFAULT_GRAPH_CURVE });
  const before = state.workingAnimation!;
  const next = editGraphKey(before, rig, ref, { time: 0.2, value: -4 });
  assert.strictEqual(before.ikTracks, next.ikTracks);
  assert.equal(next.tracks.root![0]!.y, 3);
  assert.isUndefined(next.tracks.root![0]!.x);
  assert.equal(graphKeys(next, x)[0]!.time, 200);
  assert.equal(graphKeys(next, x)[0]!.value, -4);
  assert.deepEqual(graphKeys(next, x)[0]!.curve, DEFAULT_GRAPH_CURVE);
  assert.equal(graphKeys(before, x)[0]!.time, 0);
});
test.each([-0.1, 0.5, 0.75, NaN, Infinity])('reject moving a key outside its neighbor boundaries (%s)', (time) => {
  const state = fixture();
  const before = state.workingAnimation;
  assert.throws(() => state.graph.editGraphKey(ref, { time }));
  assert.strictEqual(state.workingAnimation, before);
  assert.isFalse(state.graph.graphEditActive);
  assert.equal(state.historyLength, 0);
});
test('handle constraints clamp normalized time, progress and crossing controls before preview validation', () => {
  assert.equal(DEFAULT_GRAPH_CURVE.mode, 'bezier');
  if (DEFAULT_GRAPH_CURVE.mode !== 'bezier') return;
  const first = constrainGraphHandle(DEFAULT_GRAPH_CURVE, 'control1', { x: 8, y: -10 });
  assert.deepEqual(first, { ...DEFAULT_GRAPH_CURVE, control1: { x: 2 / 3, y: 0 } });
  assert.deepEqual(constrainGraphHandle(DEFAULT_GRAPH_CURVE, 'control2', { x: -8, y: 9 }), {
    ...DEFAULT_GRAPH_CURVE,
    control2: { x: 1 / 3, y: 1 },
  });
  assert.throws(() => constrainGraphHandle(DEFAULT_GRAPH_CURVE, 'control1', { x: NaN, y: 0 }));
});
test('invalid precision handles and bounded IK values never publish invalid previews', () => {
  const state = fixture();
  state.graph.beginGraphEdit(ref);
  const before = state.previewAnimation;
  assert.throws(() =>
    state.graph.previewGraphEdit({ curve: { mode: 'bezier', control1: { x: 0.9, y: 0 }, control2: { x: 0.1, y: 1 } } }),
  );
  assert.strictEqual(state.previewAnimation, before);
  state.graph.cancelGraphEdit();
  assert.throws(() => state.graph.editGraphKey({ channel: mix, time: 0 }, { value: 2 }));
  assert.equal(state.historyLength, 0);
});
test('completed drag is one Undo, shares timeline selection, and exports only committed curves', () => {
  const state = fixture();
  const before = state.workingAnimation;
  state.graph.beginGraphEdit(ref);
  for (let i = 1; i < 5; i++) state.graph.previewGraphEdit({ time: i / 20, value: i });
  assert.strictEqual(state.workingAnimation, before);
  assert.equal((JSON.parse(state.exportJson()) as { tracks: { root: { x: number }[] } }).tracks.root[0]!.x, -10);
  assert.isTrue(state.hasPendingAnimationEdits);
  assert.equal(state.historyLength, 0);
  assert.isTrue(state.graph.commitGraphEdit());
  assert.equal(state.historyLength, 1);
  assert.deepEqual(state.selectedKeyframe, { boneId: 'root', property: 'x', time: 0.2 });
  assert.equal(state.timelineTracks.find((row) => row.kind === 'property' && row.property === 'x')?.kind, 'property');
  assert.isFalse(state.hasPendingAnimationEdits);
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.redo();
  assert.equal(graphKeys(state.workingAnimation!, x)[0]!.time, 200);
});
test.each(['cancel', 'seek', 'selection', 'undo', 'mode', 'session'] as const)(
  '%s cancels a provisional graph gesture without history',
  (action) => {
    const state = fixture();
    const before = state.workingAnimation;
    state.graph.beginGraphEdit(ref);
    state.graph.previewGraphEdit({ curve: DEFAULT_GRAPH_CURVE });
    if (action === 'cancel') state.graph.cancelGraphEdit();
    if (action === 'seek') state.setCurrentTime(0.2);
    if (action === 'selection') state.selectTimelineProperty('root', 'y');
    if (action === 'undo') state.undo();
    if (action === 'mode') state.setEditorMode('rig');
    if (action === 'session') state.selectAnimation('graph', { keepChanges: true });
    assert.isFalse(state.graph.graphEditActive);
    assert.strictEqual(state.previewAnimation, before);
    assert.equal(state.historyLength, 0);
  },
);
test('Bézier preview updates actual puppet pose immediately and cancel restores it', () => {
  const state = fixture();
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  try {
    state.setCurrentTime(0.125);
    const before = puppet.getBone('root').pose.x;
    state.graph.beginGraphEdit(ref);
    state.graph.previewGraphEdit({ curve: { mode: 'stepped' } });
    assert.equal(puppet.getBone('root').pose.x, -10);
    assert.notEqual(before, -10);
    state.graph.cancelGraphEdit();
    assert.equal(puppet.getBone('root').pose.x, before);
    state.graph.editGraphKey(ref, { curve: { mode: 'stepped' } });
    state.playback.play();
    state.playback.advancePlayback(0.1);
    assert.equal(puppet.getBone('root').pose.x, -10);
    state.undo();
    assert.notEqual(puppet.getBone('root').pose.x, -10);
  } finally {
    preview.dispose();
    puppet.destroy();
  }
});
test('IK outgoing controls share history, selection, evaluator and serialization', () => {
  const state = fixture();
  state.ik.selectIKKeyframe({ kind: 'ik', constraintId: 'arm', property: 'mix', time: 0 });
  state.setCurrentTime(0.25);
  state.graph.beginGraphEdit({ channel: mix, time: 0 });
  state.graph.previewGraphEdit({ curve: { mode: 'stepped' } });
  assert.equal(state.ik.selectedIKTargetValues?.mix, 0);
  state.graph.commitGraphEdit();
  const animation = state.workingAnimation!;
  assert.equal(evaluateIKClip(compileClip(animation, rig), 250).get('arm')!.mix!.value, 0);
  const json = state.exportJson();
  assert.isTrue(state.reloadCurrentExport({ confirmDiscard: () => true }));
  assert.deepEqual(JSON.parse(state.exportJson()), JSON.parse(json));
  assert.deepEqual(graphKeys(state.workingAnimation!, mix)[0]!.curve, { mode: 'stepped' });
});
test('terminal keys reject curve edits; Auto removes only the selected property override', () => {
  const state = fixture();
  state.graph.editGraphKey(ref, { curve: DEFAULT_GRAPH_CURVE });
  state.graph.editGraphKey(ref, { curve: null });
  assert.isUndefined(graphKeys(state.workingAnimation!, x)[0]!.curve);
  assert.throws(() => state.graph.editGraphKey({ channel: x, time: 1 }, { curve: DEFAULT_GRAPH_CURVE }));
});
test.each([
  [-0.00001, 0.00002],
  [-1e9, 2e9],
  [-10, -10],
])('coordinates round-trip negative, small, large and flat ranges (%s, %s)', (min, max) => {
  const state = fixture();
  state.graph.editGraphKey(ref, { value: min });
  state.graph.editGraphKey({ channel: x, time: 1 }, { value: max });
  const history = state.historyLength;
  const view = fitGraph(state.workingAnimation!, x);
  for (const [width, height] of [
    [400, 200],
    [1200, 700],
  ]) {
    const point = graphToPoint(0.25, min, view, width!, height!);
    const value = pointToGraph(point.x, point.y, view, width!, height!);
    assert.closeTo(value.time, 0.25, 1e-12);
    assert.closeTo(value.value, min, Math.max(1e-10, Math.abs(min) * 1e-12));
  }
  const zoom = zoomGraph(view, 0.5, 0.25, min);
  assert.closeTo((0.25 - view.start) / (view.end - view.start), (0.25 - zoom.start) / (zoom.end - zoom.start), 1e-12);
  assert.deepEqual(panGraph(view, 0.2, -4), { start: 0.2, end: 1.2, min: view.min - 4, max: view.max - 4 });
  assert.equal(state.historyLength, history);
});

test('curve edits detach caller handles without freezing them', () => {
  const state = fixture();
  const curve = { mode: 'bezier' as const, control1: { x: 0.2, y: 0 }, control2: { x: 0.8, y: 1 } };
  state.graph.editGraphKey(ref, { curve });
  assert.isFalse(Object.isFrozen(curve.control1));
  curve.control1.x = 0.4;
  const held = graphKeys(state.workingAnimation!, x)[0]!.curve;
  assert.equal(held?.mode, 'bezier');
  if (held?.mode === 'bezier') assert.equal(held.control1.x, 0.2);
});
test('tiny property ranges fit without a fixed minimum padding dwarfing the curve', () => {
  const state = fixture();
  state.graph.editGraphKey(ref, { value: -1e-12 });
  state.graph.editGraphKey({ channel: x, time: 1 }, { value: 1e-12 });
  const view = fitGraph(state.workingAnimation!, x);
  assert.closeTo(view.max - view.min, 2.6e-12, 1e-24);
});
