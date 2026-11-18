import { EventEmitter } from 'eventemitter3';
import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorRootHandle } from '../src/devtools/animation-editor/AnimationEditorRootHandle.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  DEFAULT_GRAPH_CURVE,
  graphChannels,
  graphKeys,
  sampleGraph,
} from '../src/devtools/animation-editor/graphEditor.js';
import {
  pointerToRootPosition,
  rootMotionMatrix,
  rootPositionToWorld,
} from '../src/devtools/animation-editor/rootMotionCoordinates.js';
import { rootKeys } from '../src/devtools/animation-editor/rootMotionEdits.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { sampleRootMotion } from '../src/engine/rootMotion.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.unstubAllGlobals());
const rig = new Rig({
  root: 'pelvis',
  bones: [{ id: 'pelvis' }, { id: 'leg', parent: 'pelvis', y: 40 }, { id: 'foot', parent: 'leg', y: 40 }],
  ik: [{ name: 'legIK', rootBone: 'pelvis', middleBone: 'leg', endBone: 'foot' }],
});
function fixture(root = true) {
  const state = new AnimationEditorState(rig, [
    {
      name: 'attack',
      duration: 1000,
      loop: true,
      tracks: {
        pelvis: [
          { time: 0, y: 0 },
          { time: 1000, y: -10 },
        ],
      },
      ikTracks: { legIK: [{ time: 0, x: 10, y: 70, mix: 0.5 }] },
      ...(root
        ? {
            rootMotion: {
              translationKeys: [
                { time: 0, x: 0, y: 0 },
                { time: 1000, x: 80, y: 0 },
              ],
            },
          }
        : {}),
    },
  ]);
  state.selectAnimation('attack');
  return state;
}
const x = { kind: 'root', id: 'Root Motion', property: 'x' } as const;

test('root and graph owners hand off previews and publish committed selection with the document atomically', () => {
  const state = fixture();
  state.rootMotion.setRootMotionView({ editing: true });
  const base = state.workingAnimation;
  state.rootMotion.beginRootMotionDrag();
  state.rootMotion.previewRootMotionDrag({ x: 15, y: 20 });
  assert.notStrictEqual(state.previewAnimation, base);
  state.beginGraphEdit({ channel: x, time: 0 });
  assert.isFalse(state.rootMotion.rootMotionDragActive);
  assert.strictEqual(state.previewAnimation, base, 'graph begins from authored data, discarding the XY proposal');
  state.previewGraphEdit({ time: 0.25, value: 30 });
  const observations: unknown[] = [];
  const unsubscribe = state.subscribe(() =>
    observations.push({
      active: state.hasPendingAnimationEdits,
      selected: state.rootMotion.selectedRootKey,
      time: rootKeys(state.workingAnimation!, 'x')[0]!.time,
      preview: state.previewAnimation === state.workingAnimation,
    }),
  );
  assert.isTrue(state.commitGraphEdit());
  assert.deepEqual(observations, [
    { active: false, selected: { property: 'x', time: 0.25 }, time: 250, preview: true },
  ]);
  assert.equal(state.historyLength, 1);
  unsubscribe();
  state.undo();
  assert.strictEqual(state.workingAnimation, base);
});

test('old clips stay without root data until an explicit atomic XY creation; skeletal and IK branches retain identity', () => {
  const state = fixture(false);
  const before = state.workingAnimation!;
  state.rootMotion.selectRootMotion();
  assert.deepEqual(graphChannels(state), [x, { ...x, property: 'y' }]);
  assert.isUndefined(state.workingAnimation!.rootMotion);
  state.rootMotion.addRootPositionKey();
  assert.deepEqual(state.workingAnimation!.rootMotion, { translationKeys: [{ time: 0, x: 0, y: 0 }] });
  assert.equal(state.historyLength, 1);
  assert.strictEqual(state.workingAnimation!.tracks, before.tracks);
  assert.strictEqual(state.workingAnimation!.ikTracks, before.ikTracks);
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.redo();
  assert.exists(state.workingAnimation!.rootMotion);
});

test('root selection, numeric XY, retiming, duplication and sparse-axis deletion share document history', () => {
  const state = fixture();
  const before = state.workingAnimation!;
  state.rootMotion.setRootPosition({ x: 40, y: -20 }, 0.5);
  state.rootMotion.selectRootMotion('x', 0.5);
  assert.equal(state.currentTime, 0.5);
  state.editGraphKey({ channel: x, time: 0.5 }, { time: 0.6, value: 55 });
  assert.deepEqual(state.rootMotion.selectedRootKey, { property: 'x', time: 0.6 });
  assert.deepEqual(
    rootKeys(state.workingAnimation!, 'y').map((key) => key.time),
    [0, 500, 1000],
  );
  assert.isTrue(state.rootMotion.duplicateRootKey(0.8));
  assert.equal(rootKeys(state.workingAnimation!, 'x').find((key) => key.time === 800)!.value, 55);
  state.deleteTimelineSelection();
  assert.isFalse(rootKeys(state.workingAnimation!, 'x').some((key) => key.time === 800));
  assert.strictEqual(state.workingAnimation!.tracks, before.tracks);
  assert.strictEqual(state.workingAnimation!.ikTracks, before.ikTracks);
  for (let i = 0; i < 4; i++) state.undo();
  assert.strictEqual(state.workingAnimation, before);
});

test.each([{ mode: 'linear' } as const, { mode: 'stepped' } as const, DEFAULT_GRAPH_CURVE])(
  'root graph uses runtime $mode interpolation and existing history/tangent engine',
  (curve) => {
    const state = fixture();
    state.rootMotion.selectRootMotion('x', 0);
    const base = state.workingAnimation!;
    state.beginGraphEdit({ channel: x, time: 0 });
    for (let i = 0; i < 20; i++) state.previewGraphEdit({ curve });
    assert.strictEqual(state.workingAnimation, base);
    assert.equal(state.historyLength, 0);
    const preview = state.previewAnimation!;
    for (const seconds of [0, 0.13, 0.5, 0.9, 1])
      assert.closeTo(
        sampleGraph(preview, graphKeys(preview, x), seconds),
        sampleRootMotion(preview, seconds * 1000).x,
        1e-10,
      );
    state.commitGraphEdit();
    assert.equal(state.historyLength, 1);
    assert.deepEqual(rootKeys(state.workingAnimation!, 'x')[0]!.curve, curve);
    state.rootMotion.duplicateRootKey(0.25);
    assert.deepEqual(rootKeys(state.workingAnimation!, 'x')[1]!.curve, curve);
    state.undo();
    state.undo();
    assert.strictEqual(state.workingAnimation, base);
  },
);

test('graph collision, invalid values and terminal interpolation fail without changing authored data', () => {
  const state = fixture();
  state.rootMotion.setRootPosition({ x: 40 }, 0.5);
  const before = state.workingAnimation;
  for (const edit of [{ time: 1 }, { time: -1 }, { value: NaN }, { value: Infinity }])
    assert.throws(() => state.editGraphKey({ channel: x, time: 0.5 }, edit));
  assert.throws(() => state.editGraphKey({ channel: x, time: 1 }, { curve: DEFAULT_GRAPH_CURVE }));
  assert.strictEqual(state.workingAnimation, before);
  assert.isFalse(state.graphEditActive);
  assert.throws(() => state.rootMotion.setRootPosition({ y: Infinity }));
  assert.strictEqual(state.workingAnimation, before);
});

test('selection switches between root, bones and IK without rewriting either animation', () => {
  const state = fixture();
  const before = state.workingAnimation;
  state.rootMotion.selectRootMotion('y', 0);
  assert.isNull(state.selectedBoneId);
  assert.isNull(state.ik.selectedIKConstraintId);
  state.selectBone('pelvis');
  assert.isFalse(state.rootMotion.rootMotionSelected);
  state.rootMotion.selectRootMotion('x', 0);
  state.ik.selectIKConstraint('legIK');
  assert.isFalse(state.rootMotion.rootMotionSelected);
  assert.deepEqual(
    graphChannels(state).map((key) => key.kind),
    ['ik', 'ik', 'ik'],
  );
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, 0);
});

test.each([1, -1])(
  'root projection inverts facing %s, scale, shear, camera zoom/pan and enclosing transform',
  (facing) => {
    const matrix = rootMotionMatrix(
      { a: facing * 2, b: facing * 0.4, c: 0.3, d: 3, tx: 800, ty: 500 },
      { x: 100, y: -50 },
    );
    const root = { x: 80, y: -30 };
    const world = rootPositionToWorld(root, matrix);
    const camera = { getWorldPoint: (x: number, y: number) => ({ x: x / 2 + 100, y: y / 2 - 20 }) };
    const local = pointerToRootPosition({ x: (world.x - 100) * 2, y: (world.y + 20) * 2 }, camera, matrix)!;
    assert.closeTo(local.x, root.x, 1e-10);
    assert.closeTo(local.y, root.y, 1e-10);
    assert.isUndefined(pointerToRootPosition(root, camera, { ...matrix, a: 0, b: 0 }));
  },
);

function viewport() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', new EventTarget());
  const state = fixture();
  const scene = puppetScene();
  const input = new EventEmitter();
  const camera = {
    zoom: 2,
    scrollX: -35,
    scrollY: 20,
    getWorldPoint(x: number, y: number) {
      return { x: x / this.zoom + this.scrollX, y: y / this.zoom + this.scrollY };
    },
  };
  Object.assign(scene, { input, cameras: { main: camera } });
  const puppet = new Puppet(scene, { rig, autoUpdate: false, x: 100, y: 200 });
  const preview = new AnimationEditorPreview(state, puppet);
  const handle = new AnimationEditorRootHandle(scene, state, puppet);
  const pointer = (x: number, y: number, id = 1) =>
    ({
      id,
      button: 0,
      x: (x - camera.scrollX) * camera.zoom,
      y: (y - camera.scrollY) * camera.zoom,
    }) as Phaser.Input.Pointer;
  return {
    state,
    scene,
    input,
    camera,
    puppet,
    preview,
    handle,
    pointer,
    dispose() {
      handle.dispose();
      preview.dispose();
      puppet.destroy();
    },
  };
}

test.each(['right', 'left'] as const)(
  'root drag in facing %s moves the puppet before IK, commits one XY snapshot, and preserves camera/ground/bone/IK data',
  (facing) => {
    const f = viewport();
    try {
      const { state, puppet, handle, input, camera } = f;
      puppet.setFacing(facing);
      puppet.container.setScale(facing === 'left' ? -2 : 2, 2);
      state.setCurrentTime(0.5);
      state.rootMotion.setRootMotionView({ editing: true });
      const before = state.workingAnimation!;
      const root = { x: puppet.container.x, y: puppet.container.y };
      const cameraBefore = { ...camera };
      assert.isTrue(handle.pointerDown(f.pointer(root.x, root.y)));
      for (let i = 0; i < 25; i++)
        input.emit('pointermove', f.pointer(root.x + (facing === 'left' ? -80 : 80), root.y - 40));
      assert.strictEqual(state.workingAnimation, before);
      assert.equal(state.historyLength, 0);
      assert.closeTo(puppet.container.x, root.x + (facing === 'left' ? -80 : 80), 1e-9);
      assert.closeTo(puppet.getBone('pelvis').pose.y, -5, 1e-9);
      state.play();
      state.advancePlayback(1);
      assert.equal(state.currentTime, 0.5);
      input.emit('pointerupoutside', f.pointer(root.x + (facing === 'left' ? -80 : 80), root.y - 40));
      assert.equal(state.historyLength, 1);
      assert.isFalse(state.rootMotion.rootMotionDragActive);
      assert.deepEqual(sampleRootMotion(state.workingAnimation!, 500), { x: 80, y: -20 });
      assert.strictEqual(state.workingAnimation!.tracks, before.tracks);
      assert.strictEqual(state.workingAnimation!.ikTracks, before.ikTracks);
      assert.deepEqual(camera, cameraBefore);
      handle.render();
      state.undo();
      assert.strictEqual(state.workingAnimation, before);
      state.redo();
      assert.deepEqual(state.rootMotion.rootPosition, { x: 80, y: -20 });
      const exported = state.exportJson();
      state.reloadCurrentExport({ confirmDiscard: () => true });
      assert.equal(state.exportJson(), exported);
    } finally {
      f.dispose();
    }
  },
);

test.each(['escape', 'blur', 'seek', 'mode', 'switch', 'dispose'] as const)(
  'root gesture cancels on %s without history or export changes',
  (boundary) => {
    const f = viewport();
    try {
      const { state, handle, input, puppet } = f;
      state.rootMotion.setRootMotionView({ editing: true });
      state.setCurrentTime(0.5);
      const before = state.exportJson();
      handle.pointerDown(f.pointer(puppet.container.x, puppet.container.y));
      input.emit('pointermove', f.pointer(200, 150, 2));
      assert.isFalse(state.hasUnsavedChanges);
      input.emit('pointermove', f.pointer(200, 150));
      assert.isTrue(state.rootMotion.rootMotionDragActive);
      if (boundary === 'escape') window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
      else if (boundary === 'blur') window.dispatchEvent(new Event('blur'));
      else if (boundary === 'seek') state.setCurrentTime(0.7);
      else if (boundary === 'mode') state.setEditorMode('rig-tweak');
      else if (boundary === 'switch') state.selectAnimation(null);
      else handle.dispose();
      assert.isFalse(state.rootMotion.rootMotionDragActive);
      assert.equal(state.historyLength, 0);
      if (boundary !== 'switch') assert.equal(state.exportJson(), before);
      input.emit('pointerup', f.pointer(200, 150));
      assert.equal(state.historyLength, 0);
    } finally {
      f.dispose();
    }
  },
);

test('scrubs, stepped frames, loop playback and visibility toggles use absolute offsets without drift', () => {
  const f = viewport();
  try {
    const { state, puppet } = f;
    state.setAuthoredPlaybackMode('stepped');
    state.setAuthoredFPS(4);
    for (const time of [0.8, 0.3, 1, 0, 0.3]) {
      state.setCurrentTime(time);
      assert.closeTo(puppet.container.x, 100 + (time === 1 ? 80 : Math.floor(time * 4) * 20), 1e-9);
    }
    const history = state.historyLength;
    state.rootMotion.setRootMotionView({ visible: false });
    assert.equal(puppet.container.x, 100);
    state.rootMotion.setRootMotionView({ visible: true, trajectory: false });
    assert.equal(puppet.container.x, 120);
    assert.equal(state.historyLength, history);
    state.setPreviewLoop(true);
    state.restart();
    state.play();
    state.advancePlayback(1.3);
    assert.closeTo(state.currentTime, 0.3, 1e-9);
    assert.equal(puppet.container.x, 120);
  } finally {
    f.dispose();
  }
});

test('root mode does not pick another tool, disabled interaction cannot drag, and disposal releases input listeners', () => {
  const f = viewport();
  try {
    assert.isFalse(f.handle.pointerDown(f.pointer(100, 200)));
    f.state.rootMotion.setRootMotionView({ editing: true });
    assert.isTrue(f.handle.pointerDown(f.pointer(1000, 1000)));
    assert.isFalse(f.state.rootMotion.rootMotionDragActive);
    f.handle.setInteractive(false);
    f.handle.pointerDown(f.pointer(100, 200));
    assert.isFalse(f.state.rootMotion.rootMotionDragActive);
    f.handle.dispose();
    f.handle.dispose();
    assert.equal(f.input.listenerCount('pointermove'), 0);
  } finally {
    f.dispose();
  }
});
