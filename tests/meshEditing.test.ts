import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { RigEditorInputController } from '../src/devtools/rig-editor/RigEditorInputController.js';
import { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { localToWorld, worldToLocal } from '../src/engine/affineMath.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { createRectangleMeshAttachment, meshAttachmentToBindPose } from '../src/engine/meshAttachments.js';
import { deleteMeshVertex, meshEdges, subdivideMeshEdge } from '../src/engine/meshEditing.js';
import { validateMeshTopology } from '../src/engine/meshGeometry.js';
import { createTexturedMesh } from '../src/engine/meshRendering.js';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { Rig } from '../src/engine/Rig.js';
import type { RigDefinition } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.unstubAllGlobals());

const file: RigDefinition = {
  root: 'root',
  bones: [{ id: 'root', x: 10, rotation: 0.3, scaleX: -1.5, scaleY: 0.8 }],
  slots: [
    { id: 'sleeve', bone: 'root', x: 3, rotation: 0.2 },
    { id: 'other', bone: 'root' },
  ],
  attachments: [{ id: 'cloth', texture: 'paper', x: 7, y: -2, rotation: 0.4, scaleX: 2, originX: 0.25 }],
  skins: [
    { version: 1, name: 'default', slots: { sleeve: 'cloth', other: 'cloth' } },
    { version: 1, name: 'inherited', slots: {} },
    { version: 1, name: 'alternate', slots: { sleeve: 'cloth' } },
  ],
};
const size = { width: 80, height: 40 };
const rectangle = () => createRectangleMeshAttachment({ ...file.attachments![0]!, type: 'sprite' }, size, file);
function stateFixture(skin = 'default') {
  const state = new RigEditorState(new Rig(file));
  state.selectSkin(skin);
  state.selectSlot('sleeve');
  state.convertSelectedSpriteToMesh(size);
  return state;
}

test('conversion retains rigid source, image, placement, unrelated skin assignments and bones; one undo restores all data', () => {
  const state = stateFixture();
  assert.equal(state.historyLength, 1);
  assert.equal(state.activeSkin, 'default-mesh');
  assert.deepEqual(state.getAttachment('cloth'), file.attachments![0]);
  assert.deepEqual(state.workingCopy.skins!.slice(0, 3), file.skins);
  assert.deepEqual(state.workingCopy.bones, file.bones);
  const mesh = state.selectedMesh!;
  assert.equal(mesh.texture, 'paper');
  assert.equal(mesh.x, 7);
  assert.equal(mesh.rotation, 0.4);
  assert.deepEqual(mesh.vertices[0], { id: 'top-left', x: -20, y: -20, u: 0, v: 0 });
  assert.equal(state.resolvedAttachment('other'), 'cloth');
  const converted = state.workingCopy;
  state.undo();
  assert.isUndefined(state.selectedMesh);
  assert.deepEqual(state.workingCopy.attachments, file.attachments);
  state.redo();
  assert.deepEqual(state.workingCopy, converted);
  assert.equal(state.selectedMesh!.id, mesh.id);
  assert.deepEqual(state.source.attachments, file.attachments);
});

test('nondefault and external skin conversion modifies only the chosen mapping', () => {
  const state = stateFixture('alternate');
  assert.equal(state.activeSkin, 'alternate');
  assert.deepEqual(state.getSkin('default'), file.skins![0]);
  assert.deepEqual(state.getSkin('inherited'), file.skins![1]);
  const external = new RigEditorState(new Rig(file), undefined, {
    standaloneSkins: [{ version: 1, name: 'external', slots: {} }],
  });
  external.selectSkin('external');
  external.selectSlot('sleeve');
  external.convertSelectedSpriteToMesh(size);
  assert.deepEqual(external.workingCopy.skins, file.skins);
  assert.equal(external.resolvedAttachment('sleeve', 'external'), 'cloth-mesh');
  external.undo();
  assert.deepEqual(external.getSkin('external').slots, {});
});

test('shared-edge subdivision splits both triangles with consistent winding and interpolated UVs; deletion restores coverage', () => {
  const mesh = rectangle();
  const next = subdivideMeshEdge(mesh, 0, 2, file);
  assert.equal(next.vertices.length, 5);
  assert.equal(next.triangles.length, 12);
  assert.deepEqual(next.vertices[4], { id: 'vertex-1', x: 20, y: 0, u: 0.5, v: 0.5 });
  assert.deepEqual(validateMeshTopology(next), []);
  assert.isFalse(meshEdges(next).some(([a, b]) => a === 0 && b === 2));
  assert.deepEqual(mesh.vertices.length, 4);
  const removed = deleteMeshVertex(next, 'vertex-1', file);
  assert.deepEqual(removed.vertices, mesh.vertices);
  assert.equal(removed.triangles.length, 6);
  assert.deepEqual(validateMeshTopology(removed), []);
});

test('boundary subdivision preserves endpoint UVs; delete retriangulates without renumbering stable IDs', () => {
  const mesh = rectangle();
  const next = subdivideMeshEdge(mesh, 1, 0, file);
  assert.equal(next.triangles.length, 9);
  assert.deepEqual(next.vertices[4], { id: 'vertex-1', x: 20, y: -20, u: 0.5, v: 0 });
  const removed = deleteMeshVertex(next, 'vertex-1', file);
  assert.deepEqual(removed.vertices, mesh.vertices);
  assert.deepEqual(validateMeshTopology(removed), []);
  assert.throws(() => deleteMeshVertex(mesh, 'top-right', file), /corner/);
  assert.throws(() => subdivideMeshEdge(mesh, 1, 3, file), /existing mesh edge/);
});

test('vertex operations preserve UVs, reject invalid geometry atomically, group history and round trip export/import', () => {
  const state = stateFixture();
  const before = state.selectedMesh!;
  state.selectedMeshEdge = [0, 2];
  state.subdivideSelectedMeshEdge();
  assert.equal(state.historyLength, 2);
  state.beginOperation();
  state.moveMeshVertex('vertex-1', 21, 1);
  state.moveMeshVertex('vertex-1', 23, 2);
  assert.throws(() => state.moveMeshVertex('vertex-1', 1000, 1000), /clockwise|overlap/);
  assert.equal(state.selectedMesh!.vertices[4]!.x, 23);
  state.endOperation();
  assert.equal(state.historyLength, 3);
  assert.equal(state.selectedMesh!.vertices[4]!.u, 0.5);
  const after = state.selectedMesh;
  state.undo();
  assert.equal(state.selectedMesh!.vertices[4]!.x, 20);
  state.redo();
  assert.deepEqual(state.selectedMesh, after);
  state.beginOperation();
  state.moveMeshVertex('vertex-1', 24, 2);
  state.cancelOperation();
  assert.deepEqual(state.selectedMesh, after);
  assert.equal(state.historyLength, 3);
  const imported = new RigEditorState(parseRigDefinition(JSON.parse(state.exportJson(false))));
  imported.selectSkin('default-mesh');
  imported.selectSlot('sleeve');
  assert.deepEqual(imported.selectedMesh, state.selectedMesh);
  assert.deepEqual(imported.workingCopy.bones, file.bones);
  state.selectedMeshVertexId = 'vertex-1';
  state.deleteSelectedMeshVertex();
  assert.equal(state.selectedMesh!.vertices.length, before.vertices.length);
  state.undo();
  assert.equal(state.selectedMesh!.vertices.length, 5);
});

test('renderer uses native local XYUV geometry, slot affine, opacity/order, replacements and borrowed texture cleanup', () => {
  const scene = puppetScene();
  const state = stateFixture();
  const puppet = new Puppet(scene, { rig: state.workingCopy, skin: 'default-mesh', autoUpdate: false });
  const mesh = puppet.getSlotMesh('sleeve')!;
  assert.deepEqual(mesh.vertices.slice(0, 4), [-20, -20, 0, 0]);
  assert.deepEqual(mesh.indices, [0, 1, 2, 0, 0, 2, 3, 0]);
  assert.isTrue(mesh.renderAsTriangles);
  assert.equal(mesh.originX, 0);
  const expected = meshAttachmentToBindPose(state.selectedMesh!, 'sleeve', state.selectedMesh!.vertices[0]!);
  const rendered = localToWorld(state.selectedMesh!.vertices[0]!, mesh.getWorldTransformMatrix());
  assert.closeTo(rendered.x, expected.x, 1e-10);
  assert.closeTo(rendered.y, expected.y, 1e-10);
  mesh.setAlpha(0.3).setVisible(false);
  puppet.setAttachment('sleeve', 'cloth');
  assert.isTrue(mesh.isDestroyed);
  assert.isUndefined(puppet.getSlotMesh('sleeve'));
  assert.equal(puppet.getSlotImage('sleeve')!.alpha, 0.3);
  puppet.setAttachment('sleeve', 'cloth-mesh');
  const next = puppet.getSlotMesh('sleeve')!;
  assert.equal(next.alpha, 0.3);
  assert.isFalse(next.visible);
  puppet.setArtworkReplacement('paper', { textureKey: 'replacement', originScaleX: 1, originScaleY: 1 });
  assert.equal(next.texture.key, 'replacement');
  assert.deepEqual(next.vertices, mesh.vertices);
  assert.throws(
    () => puppet.setArtworkReplacement('paper', { textureKey: 'bad', originScaleX: 2, originScaleY: 1 }),
    /preserve/,
  );
  assert.equal(next.texture.key, 'replacement');
  const remove = vi.fn();
  Object.assign(scene.textures, { remove });
  puppet.destroy();
  puppet.destroy();
  assert.isTrue(next.isDestroyed);
  assert.equal(remove.mock.calls.length, 0);
});

function inputFixture() {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  const state = stateFixture(),
    scene = puppetScene();
  const puppet = new Puppet(scene, { rig: state.workingCopy, skin: state.activeSkin, x: 90, y: 70, autoUpdate: false });
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
      refresh: vi.fn(),
      moveCharacter: vi.fn(),
      previewArtwork: vi.fn(),
      finishArtworkGesture: vi.fn(),
    },
    overlay,
    vi.fn(),
    vi.fn(),
  );
  controller.enable();
  const position = (point: { x: number; y: number }) => {
    const world = localToWorld(point, puppet.getSlotMesh('sleeve')!.getWorldTransformMatrix());
    return { x: (world.x - camera.scrollX) * camera.zoom, y: (world.y - camera.scrollY) * camera.zoom };
  };
  const event = (name: string, point: { x: number; y: number }) =>
    handlers.get(name)!({
      id: 1,
      isDown: true,
      ...position(point),
      leftButtonDown: () => true,
      middleButtonDown: () => false,
    });
  return { state, scene, camera, puppet, overlay, controller, event, browser, position };
}

test('vertex picking and drag use full reflected affine and zoom/pan; a completed drag records once and Escape cancels', () => {
  const f = inputFixture();
  const initial = f.state.selectedMesh!.vertices[0]!;
  const point = f.position(initial);
  assert.equal(f.overlay.pickMeshVertex(point.x, point.y)?.id, initial.id);
  const local = worldToLocal(
    f.camera.getWorldPoint(point.x, point.y),
    f.puppet.getSlotMesh('sleeve')!.getWorldTransformMatrix(),
  )!;
  assert.closeTo(local.x, initial.x, 1e-10);
  f.event('pointerdown', initial);
  f.event('pointermove', { x: initial.x - 4, y: initial.y - 3 });
  f.event('pointermove', { x: initial.x - 8, y: initial.y - 5 });
  f.event('pointerup', { x: initial.x - 8, y: initial.y - 5 });
  assert.equal(f.state.historyLength, 2);
  assert.closeTo(f.state.selectedMesh!.vertices[0]!.x, initial.x - 8, 1e-9);
  f.state.undo();
  assert.deepEqual(f.state.selectedMesh!.vertices[0], initial);
  f.state.redo();
  const before = f.state.workingCopy;
  const current = f.state.selectedMesh!.vertices[0]!;
  f.event('pointerdown', current);
  f.event('pointermove', { x: current.x - 5, y: current.y - 2 });
  const escape = new Event('keydown', { cancelable: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  f.browser.dispatchEvent(escape);
  f.event('pointerup', current);
  assert.deepEqual(f.state.workingCopy, before);
  assert.equal(f.state.historyLength, 2);
  f.controller.disable();
  f.overlay.destroy();
  f.puppet.destroy();
});

test('render-only previews retain native meshes across copies, update geometry and release them on rigid switching', () => {
  const state = stateFixture(),
    scene = puppetScene();
  const rig = new Rig(state.workingCopy);
  const puppet = new Puppet(scene, { rig, skin: state.activeSkin, autoUpdate: false });
  const preview = new PuppetRenderer(
    scene,
    scene.add.container(),
    rig,
    new Map(rig.bones.map((bone) => [bone.id, puppet.getBone(bone.id)])),
  );
  puppet.copyAppearanceTo(preview, 0xabcdef);
  const first = preview.getSlotMesh('sleeve')!;
  assert.deepEqual(first.vertices, puppet.getSlotMesh('sleeve')!.vertices);
  const revision = puppet.getAppearanceRevision();
  state.moveMeshVertex('top-left', -25, -22);
  const old = puppet.getSlotMesh('sleeve')!;
  puppet.updateSlotDefinitions(state.workingCopy.attachments!, state.skins);
  assert.isTrue(old.isDestroyed);
  assert.notEqual(puppet.getAppearanceRevision(), revision);
  puppet.copyAppearanceTo(preview, 0xabcdef);
  assert.strictEqual(preview.getSlotMesh('sleeve'), first);
  assert.equal(first.vertices[0], -25);
  assert.notStrictEqual(first.vertices, puppet.getSlotMesh('sleeve')!.vertices);
  puppet.setAttachment('sleeve', 'cloth');
  puppet.copyAppearanceTo(preview, 0xabcdef);
  assert.isTrue(first.isDestroyed);
  assert.isUndefined(preview.getSlotMesh('sleeve'));
  assert.exists(preview.getSlotImage('sleeve'));
  preview.destroy();
  puppet.destroy();
});

test('native mesh setup failures destroy the incomplete geometry object', () => {
  const scene = puppetScene();
  const factory = scene.add.mesh2d.bind(scene.add);
  let incomplete: Phaser.GameObjects.Mesh2D | undefined;
  scene.add.mesh2d = (...args) => {
    incomplete = factory(...args);
    incomplete.setOrigin = () => {
      throw new Error('setup failed');
    };
    return incomplete;
  };
  assert.throws(() => createTexturedMesh(scene, rectangle()), /setup failed/);
  assert.isTrue(incomplete!.isDestroyed);
});

test('the displayed mesh snap grid uses attachment-local coordinates under rotated/reflected slot transforms', () => {
  const f = inputFixture();
  f.overlay.destroy();
  const grid: number[][] = [];
  const graphics = f.scene.add.graphics.bind(f.scene.add);
  let count = 0;
  f.scene.add.graphics = (...args) => {
    const g = graphics(...args);
    if (++count === 1)
      g.lineBetween = (...coordinates) => {
        grid.push(coordinates);
        return g;
      };
    return g;
  };
  const text = f.scene.add.text.bind(f.scene.add);
  f.scene.add.text = (...args) =>
    Object.assign(text(...args), {
      setText() {
        return this;
      },
      setColor() {
        return this;
      },
    });
  Object.assign(f.camera, {
    x: 0,
    y: 0,
    width: 760,
    height: 640,
    originX: 0.5,
    originY: 0.5,
    matrixCombined: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  });
  for (const key of Object.keys(f.state.visibility) as (keyof typeof f.state.visibility)[])
    f.state.visibility[key] = false;
  f.state.gridSnap = 5;
  const overlay = new RigEditorOverlay(f.scene, f.puppet, f.state, []);
  overlay.draw();
  assert.isAbove(grid.length, 0);
  const matrix = f.puppet.getSlotMesh('sleeve')!.getWorldTransformMatrix();
  for (const [x1, y1, x2, y2] of grid) {
    const a = worldToLocal(f.camera.getWorldPoint(x1!, y1!), matrix)!;
    const b = worldToLocal(f.camera.getWorldPoint(x2!, y2!), matrix)!;
    const fixed = Math.abs(a.x - b.x) < 1e-8 ? a.x : a.y;
    assert.isTrue(Math.abs(a.x - b.x) < 1e-8 || Math.abs(a.y - b.y) < 1e-8);
    assert.closeTo(fixed / 5, Math.round(fixed / 5), 1e-8);
  }
  f.controller.disable();
  overlay.destroy();
  f.puppet.destroy();
});
