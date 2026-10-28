import type Phaser from 'phaser';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { AttachmentController } from '../src/devtools/rig-editor/AttachmentController.js';
import { MeshGeometryPanel } from '../src/devtools/rig-editor/MeshGeometryPanel.js';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorInputController } from '../src/devtools/rig-editor/RigEditorInputController.js';
import { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { localToWorld } from '../src/engine/affineMath.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { subdivideMeshEdge, deleteMeshVertex } from '../src/engine/meshEditing.js';
import { createMeshSkinBinding, deformMesh } from '../src/engine/meshSkinning.js';
import {
  boneWeightColor,
  MeshWeightStroke,
  setBoneWeight,
  type WeightBrushOptions,
} from '../src/engine/meshWeightPainting.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import type { BoneInfluence, RigDefinition } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.unstubAllGlobals());

const rig: RigDefinition = {
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'upper', parent: 'root' },
    { id: 'forearm', parent: 'upper', y: 20 },
    { id: 'extra', parent: 'root' },
  ],
  slots: [{ id: 'sleeve', bone: 'upper' }],
  attachments: [{ id: 'cloth', texture: 'paper' }],
  skins: [{ version: 1, name: 'default', slots: { sleeve: 'cloth' } }],
};
const mesh = () =>
  createRectangleMeshAttachment({ id: 'mesh', texture: 'paper' }, { width: 80, height: 40 }, rig, 'upper');
function fixture() {
  const state = new RigEditorState(new Rig(rig));
  state.selectSlot('sleeve');
  state.convertSelectedSpriteToMesh({ width: 80, height: 40 });
  state.editMode = 'weights';
  state.selectWeightBone('forearm');
  return state;
}
const weight = (weights: readonly BoneInfluence[], id: string) =>
  weights.find((entry) => entry.boneId === id)?.weight ?? 0;
function normalized(weights: readonly BoneInfluence[]) {
  assert.isAtLeast(weights.length, 1);
  assert.isAtMost(weights.length, 4);
  assert.closeTo(
    weights.reduce((sum, entry) => sum + entry.weight, 0),
    1,
    1e-12,
  );
  assert.isTrue(weights.every((entry) => entry.weight >= 0 && Number.isFinite(entry.weight)));
}

test('numeric edits add, reduce and erase one influence while preserving other ratios and valid fallback', () => {
  const original = [
    { boneId: 'upper', weight: 0.6 },
    { boneId: 'extra', weight: 0.4 },
  ];
  const painted = setBoneWeight(original, 'forearm', 0.5, 'upper');
  assert.closeTo(weight(painted, 'upper'), 0.3, 1e-12);
  assert.closeTo(weight(painted, 'extra'), 0.2, 1e-12);
  const erased = setBoneWeight(painted, 'forearm', 0, 'upper');
  assert.deepEqual(erased, original);
  assert.deepEqual(setBoneWeight([{ boneId: 'upper', weight: 1 }], 'upper', 0, 'root'), [
    { boneId: 'root', weight: 1 },
  ]);
  assert.deepEqual(setBoneWeight([{ boneId: 'root', weight: 1 }], 'root', 0, 'root'), [{ boneId: 'root', weight: 1 }]);
  for (const value of [painted, erased]) normalized(value);
  assert.throws(() => setBoneWeight(original, 'upper', NaN, 'root'), /between/);
  assert.throws(() => setBoneWeight(original, 'upper', -0.1, 'root'), /between/);
});

test('influence cap retains the edited bone and strongest remaining weights, with stable ID ties', () => {
  const original = ['d', 'c', 'b', 'a'].map((boneId) => ({ boneId, weight: 0.25 }));
  const next = setBoneWeight(original, 'new', 0.01, 'root');
  assert.deepEqual(
    next.map((entry) => entry.boneId),
    ['new', 'a', 'b', 'c'],
  );
  normalized(next);
  assert.deepEqual(setBoneWeight(original, 'new', 0.2, 'root', 1), [{ boneId: 'new', weight: 1 }]);
  assert.deepEqual(setBoneWeight(original, 'new', 0, 'root', 1), [{ boneId: 'a', weight: 1 }]);
  for (const limit of [0, 5, 1.5]) assert.throws(() => setBoneWeight(original, 'a', 0.1, 'root', limit), /one to four/);
});

const brush: WeightBrushOptions = {
  boneId: 'forearm',
  rigidBoneId: 'upper',
  fallbackBoneId: 'upper',
  radius: 20,
  strength: 0.4,
  erase: false,
  limit: 4,
};
const points = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 20, y: 0 },
  { x: 100, y: 0 },
];
test('brush uses radius, linear falloff and strength without moving or creating vertices or accumulating repeated events', () => {
  const original = mesh();
  const stroke = new MeshWeightStroke(original, points, points[0]!, brush);
  const result = stroke.sample(points[0]!);
  assert.closeTo(weight(result.mesh.vertices[0]!.influences!, 'forearm'), 0.4, 1e-12);
  assert.closeTo(weight(result.mesh.vertices[1]!.influences!, 'forearm'), 0.2, 1e-12);
  assert.strictEqual(result.mesh.vertices[2], original.vertices[2]);
  assert.strictEqual(result.mesh.vertices[3], original.vertices[3]);
  assert.deepEqual(stroke.sample(points[0]!).mesh, result.mesh);
  assert.deepEqual(
    result.mesh.vertices.map(({ influences: _weights, ...vertex }) => vertex),
    original.vertices.map(({ influences: _weights, ...vertex }) => vertex),
  );
  assert.deepEqual(result.mesh.triangles, original.triangles);
  assert.deepEqual(original.vertices[0]!.influences, [{ boneId: 'upper', weight: 1 }]);
  const zero = new MeshWeightStroke(original, points, points[0]!, { ...brush, strength: 0 });
  assert.equal(zero.sample(points[1]!).changed, 0);
  assert.throws(() => new MeshWeightStroke(original, points, points[0]!, { ...brush, radius: 0 }), /positive/);
});

test('swept segments cover skipped vertices identically to collinear intermediate events; erase reduces weight', () => {
  const a = new MeshWeightStroke(mesh(), points, { x: -30, y: 0 }, brush);
  const b = new MeshWeightStroke(mesh(), points, { x: -30, y: 0 }, brush);
  a.sample({ x: -30, y: 0 });
  b.sample({ x: -30, y: 0 });
  b.sample({ x: 5, y: 0 });
  const end = { x: 50, y: 0 };
  const painted = a.sample(end);
  assert.deepEqual(painted.mesh, b.sample(end).mesh);
  const erased = new MeshWeightStroke(painted.mesh, points, points[0]!, {
    ...brush,
    erase: true,
    strength: 0.1,
  }).sample(points[0]!);
  assert.closeTo(weight(erased.mesh.vertices[0]!.influences!, 'forearm'), 0.3, 1e-12);
});

test('painted legacy mesh materializes only edited vertices with the selected slot as rigid baseline', () => {
  const legacy = { ...mesh(), vertices: mesh().vertices.map(({ influences: _weights, ...vertex }) => vertex) };
  const next = new MeshWeightStroke(legacy, points, points[0]!, {
    ...brush,
    boneId: 'upper',
    fallbackBoneId: 'root',
    erase: true,
  }).sample(points[0]!).mesh;
  assert.closeTo(weight(next.vertices[0]!.influences!, 'upper'), 0.6, 1e-12);
  assert.closeTo(weight(next.vertices[0]!.influences!, 'root'), 0.4, 1e-12);
  assert.notProperty(next.vertices[3]!, 'influences');
  const split = subdivideMeshEdge(next, 0, 2, rig, 'upper');
  assert.closeTo(weight(split.vertices[4]!.influences!, 'root'), 0.2, 1e-12);
  normalized(split.vertices[4]!.influences!);
});

test('stroke commit is one undo transaction; cancellation/no-op preserves history and brush selection is view state', () => {
  const state = fixture(),
    initial = state.workingCopy,
    history = state.historyLength;
  state.beginWeightStroke(points, points[0]!);
  state.continueWeightStroke(points[1]!);
  state.continueWeightStroke(points[2]!);
  state.finishWeightStroke();
  assert.equal(state.historyLength, history + 1);
  const painted = state.workingCopy;
  state.undo();
  assert.deepEqual(state.workingCopy, initial);
  state.redo();
  assert.deepEqual(state.workingCopy, painted);
  state.beginWeightStroke(points, points[0]!);
  state.continueWeightStroke(points[3]!);
  state.finishWeightStroke(false);
  assert.deepEqual(state.workingCopy, painted);
  assert.equal(state.historyLength, history + 1);
  state.brushStrength = 0;
  state.beginWeightStroke(points, points[0]!);
  state.finishWeightStroke();
  assert.equal(state.historyLength, history + 1);
  const beforeSelection = state.selection;
  state.selectWeightBone('upper');
  assert.strictEqual(state.selection, beforeSelection);
  assert.deepEqual(state.workingCopy, painted);
  assert.throws(() => state.selectWeightBone('deleted'), /Unknown|Missing|bone/i);
});

test('numeric edits and cap change affect only the selected vertex; normalize and reset undo and export losslessly', () => {
  const state = fixture(),
    original = state.selectedMesh!;
  state.selectedMeshVertexId = original.vertices[0]!.id;
  state.editSelectedVertexWeight(0.7);
  assert.closeTo(weight(state.selectedMesh!.vertices[0]!.influences!, 'forearm'), 0.7, 1e-12);
  assert.deepEqual(state.selectedMesh!.vertices.slice(1), original.vertices.slice(1));
  const before = state.workingCopy;
  state.setWeightInfluenceLimit(1);
  assert.strictEqual(state.workingCopy, before);
  state.editSelectedVertexWeight(0.2);
  assert.deepEqual(state.selectedMesh!.vertices[0]!.influences, [{ boneId: 'forearm', weight: 1 }]);
  assert.match(state.meshFeedback, /1 other influences dropped/);
  state.undo();
  state.normalizeSelectedMeshWeights();
  state.normalizeSelectedMeshWeights(true);
  assert.deepEqual(state.selectedMesh!.vertices, original.vertices);
  state.undo();
  assert.deepEqual(state.workingCopy, before);
  const reloaded = new RigEditorState(parseRigDefinition(JSON.parse(state.exportJson(false))));
  reloaded.selectSkin(state.activeSkin);
  reloaded.selectSlot('sleeve');
  assert.deepEqual(reloaded.selectedMesh, state.selectedMesh);
  assert.notInclude(state.exportJson(false), 'brushRadius');
});

test('subdivision blends painted endpoints and deletion removes only obsolete vertex weights', () => {
  const state = fixture();
  state.selectedMeshVertexId = 'top-left';
  state.editSelectedVertexWeight(0.8);
  state.selectedMeshVertexId = 'bottom-right';
  state.editSelectedVertexWeight(0.2);
  const before = state.selectedMesh!;
  state.selectedMeshEdge = [0, 2];
  state.subdivideSelectedMeshEdge();
  const midpoint = state.selectedMesh!.vertices[4]!;
  assert.closeTo(weight(midpoint.influences!, 'forearm'), 0.5, 1e-12);
  normalized(midpoint.influences!);
  assert.deepEqual(state.selectedMesh!.vertices.slice(0, 4), before.vertices);
  const deleted = deleteMeshVertex(state.selectedMesh!, midpoint.id, state.workingCopy);
  assert.deepEqual(deleted.vertices, before.vertices);
});

test('bone deletion and rename report mesh dependencies; explicit reassignment merges weights, rebinds and undoes atomically', () => {
  const state = fixture();
  state.selectedMeshVertexId = 'top-left';
  state.editSelectedVertexWeight(0.6);
  const before = state.workingCopy,
    history = state.historyLength;
  assert.match(state.boneDependencies('forearm').join(', '), /mesh.*cloth-mesh/);
  assert.throws(() => state.removeBone('forearm'), /Reassign mesh/);
  assert.throws(() => state.renameBone('forearm', 'new'), /mesh/);
  assert.deepEqual(state.workingCopy, before);
  state.removeBoneAndReassignMeshes('forearm', 'upper');
  assert.equal(state.historyLength, history + 1);
  assert.isFalse(state.rig.hasBone('forearm'));
  const changed = state.getAttachment('cloth-mesh');
  assert.equal(changed.type, 'mesh');
  if (changed.type !== 'mesh') return;
  assert.deepEqual(changed.vertices[0]!.influences, [{ boneId: 'upper', weight: 1 }]);
  assert.isFalse(changed.bindPose.bones.some((entry) => entry.id === 'forearm'));
  assert.doesNotThrow(() => parseRigDefinition(JSON.parse(state.exportJson(false))));
  state.undo();
  assert.deepEqual(state.workingCopy, before);
  state.redo();
  assert.isFalse(state.rig.hasBone('forearm'));
  assert.throws(() => state.removeBoneAndReassignMeshes('upper', 'root'), /slot/);
});

test('live test bend and painted mesh match exported runtime skinning without authoring poses or keys', () => {
  const state = fixture(),
    scene = puppetScene();
  const puppet = new Puppet(scene, { rig: state.workingCopy, skin: state.activeSkin, autoUpdate: false });
  const editor = new RigEditor(scene, puppet, vi.fn(), state);
  const controller = new AttachmentController();
  controller.bind(editor);
  editor.refresh();
  state.selectedMeshVertexId = 'top-left';
  controller.editWeight(0.55);
  const before = state.workingCopy,
    history = state.historyLength;
  controller.weightPreview(true, 'forearm', 65);
  assert.strictEqual(state.workingCopy, before);
  assert.equal(state.historyLength, history);
  const reloaded = new Puppet(scene, {
    rig: parseRigDefinition(JSON.parse(state.exportJson(false))),
    skin: state.activeSkin,
    autoUpdate: false,
  });
  reloaded.getBone('forearm').pose.rotation += (65 * Math.PI) / 180;
  reloaded.syncPose();
  assert.deepEqual(puppet.getSlotMesh('sleeve')!.vertices, reloaded.getSlotMesh('sleeve')!.vertices);
  const projection = () => {
    const object = puppet.getSlotMesh('sleeve')!,
      matrix = object.getWorldTransformMatrix();
    return state.selectedMesh!.vertices.map((_, index) =>
      localToWorld({ x: object.vertices[index * 4]!, y: object.vertices[index * 4 + 1]! }, matrix),
    );
  };
  const beforePaint = projection();
  state.brushRadius = 10;
  state.beginWeightStroke(beforePaint, beforePaint[0]!);
  state.finishWeightStroke();
  editor.refresh();
  assert.notDeepEqual(projection(), beforePaint);
  const binding = createMeshSkinBinding(state.selectedMesh!, 'sleeve');
  const expected = deformMesh(binding, (id) => puppet.getBone(id).container.getWorldTransformMatrix());
  const actual = projection();
  actual.forEach((point, index) => {
    assert.closeTo(point.x, expected[index * 4]!, 1e-9);
    assert.closeTo(point.y, expected[index * 4 + 1]!, 1e-9);
  });
  controller.weightPreview(false, 'forearm', 65);
  assert.notDeepEqual(projection(), actual);
  controller.dispose();
  puppet.destroy();
  reloaded.destroy();
});

test('inspector exposes hierarchy bone selection, brush/numeric controls and collapsed deformation preview', () => {
  const state = fixture(),
    scene = puppetScene();
  const puppet = new Puppet(scene, { rig: state.workingCopy, skin: state.activeSkin, autoUpdate: false });
  const editor = new RigEditor(scene, puppet, vi.fn(), state);
  const controller = new AttachmentController();
  controller.bind(editor);
  const markup = renderToStaticMarkup(createElement(MeshGeometryPanel, { controller }));
  for (const text of [
    'Paint Bone Weights',
    'Influence bone',
    'forearm',
    'Brush radius',
    'Brush strength',
    'Weight vertex',
    'Selected bone weight',
    'Normalize mesh weights',
    'Reset mesh weights',
  ])
    assert.include(markup, text);
  assert.match(markup, /<details[^>]*><summary>Preview deformation/);
  assert.notMatch(markup, /<details[^>]*\sopen/);
  assert.notEqual(boneWeightColor(0), boneWeightColor(0.01));
  assert.notEqual(boneWeightColor(0.01), boneWeightColor(1));
  controller.dispose();
  puppet.destroy();
});

test('canvas brushes hit evaluated vertices through facing/zoom/pan; release commits once and Escape/blur cancels', () => {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  const state = fixture(),
    scene = puppetScene();
  const puppet = new Puppet(scene, { rig: state.workingCopy, skin: state.activeSkin, x: 90, y: 70, autoUpdate: false });
  puppet.container.setScale(-1.5, 0.8);
  puppet.getBone('forearm').pose.rotation = 0.5;
  puppet.syncPose();
  const camera = {
    zoom: 2.3,
    scrollX: -120,
    scrollY: 65,
    getWorldPoint(x: number, y: number) {
      return { x: x / this.zoom + this.scrollX, y: y / this.zoom + this.scrollY };
    },
  };
  scene.cameras = { main: camera } as unknown as Phaser.Cameras.Scene2D.CameraManager;
  const handlers = new Map<string, (...args: unknown[]) => void>();
  scene.input = {
    on(name: string, fn: (...args: unknown[]) => void, context: unknown) {
      handlers.set(name, fn.bind(context));
    },
    off() {},
  } as unknown as Phaser.Input.InputPlugin;
  const overlay = new RigEditorOverlay(scene, puppet, state, []);
  const controller = new RigEditorInputController(
    scene,
    puppet,
    {
      state,
      editBone: vi.fn(),
      undo: () => state.undo(),
      redo: () => state.redo(),
      refresh: () => {
        puppet.updateSlotDefinitions(state.workingCopy.attachments!, state.skins);
        puppet.syncPose();
      },
      moveCharacter: vi.fn(),
      previewArtwork: vi.fn(),
      finishArtworkGesture: vi.fn(),
    },
    overlay,
    vi.fn(),
    vi.fn(),
  );
  controller.enable();
  const first = overlay.getMeshVertices()[0]!,
    history = state.historyLength;
  const emit = (name: string, point = first.screen, id = 1) =>
    handlers.get(name)!({ id, isDown: true, ...point, leftButtonDown: () => true, middleButtonDown: () => false });
  state.brushRadius = 15;
  emit('pointerdown');
  emit('pointermove');
  emit('pointermove');
  emit('pointerup', first.screen, 2);
  assert.isTrue(state.paintingWeights);
  emit('pointerup');
  assert.equal(state.historyLength, history + 1);
  assert.closeTo(weight(state.selectedMesh!.vertices[0]!.influences!, 'forearm'), 0.25, 1e-12);
  const after = state.workingCopy;
  for (const cancel of ['Escape', 'blur']) {
    const current = overlay.getMeshVertices()[0]!.screen;
    emit('pointerdown', current);
    emit('pointermove', { x: current.x + 2, y: current.y });
    const event = new Event(cancel === 'Escape' ? 'keydown' : 'blur', { cancelable: true });
    if (cancel === 'Escape') Object.assign(event, { key: 'Escape' });
    browser.dispatchEvent(event);
    emit('pointerup', current);
    assert.deepEqual(state.workingCopy, after);
    assert.isFalse(state.paintingWeights);
    assert.equal(state.historyLength, history + 1);
  }
  const object = puppet.getSlotMesh('sleeve')!,
    matrix = object.getWorldTransformMatrix();
  const projected = overlay.getMeshVertices()[0]!.screen;
  const world = localToWorld({ x: object.vertices[0]!, y: object.vertices[1]! }, matrix);
  assert.closeTo(projected.x, (world.x - camera.scrollX) * camera.zoom, 1e-9);
  controller.disable();
  overlay.destroy();
  puppet.destroy();
});
