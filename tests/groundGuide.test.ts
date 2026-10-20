import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { panCamera, zoomCameraAt } from '../src/devtools/shared/editorCamera.js';
import {
  defaultGroundGuide,
  groundGuideGeometry,
  groundGuideSchema,
  updateGroundGuide,
} from '../src/devtools/shared/groundGuide.js';
import { GroundGuideControls } from '../src/devtools/shared/GroundGuideControls.js';
import { GroundGuideOverlay } from '../src/devtools/shared/GroundGuideOverlay.js';
import { GroundGuideWorkspace } from '../src/devtools/shared/GroundGuideWorkspace.js';
import { CHARACTER_PREVIEW_ORIGIN } from '../src/devtools/shared/previewPlacement.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { puppetScene } from './helpers/puppetScene.js';

afterEach(() => vi.unstubAllGlobals());

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function camera(zoom = 1) {
  return {
    scrollX: -400,
    scrollY: -350,
    width: 1000,
    height: 700,
    zoom,
    originX: 0.5,
    originY: 0.5,
    setZoom(value: number) {
      this.zoom = value;
    },
  };
}

test('ground defaults are disabled, immutable and owned by distinct coordinate domains', () => {
  assert.deepEqual(defaultGroundGuide('scene-world'), { enabled: false, y: 0, snapEnabled: false });
  assert.equal(defaultGroundGuide('animation-preview-world').y, CHARACTER_PREVIEW_ORIGIN.y);
  const initial = defaultGroundGuide('scene-world');
  const next = updateGroundGuide(initial, { enabled: true, y: -123.75, snapEnabled: true });
  assert.isTrue(Object.isFrozen(initial));
  assert.isTrue(Object.isFrozen(next));
  assert.equal(initial.y, 0);
  assert.deepEqual(next, { enabled: true, y: -123.75, snapEnabled: true });
});

test.each([NaN, Infinity, -Infinity])('invalid ground Y %s cannot enter settings or persistence schemas', (y) => {
  const initial = updateGroundGuide(defaultGroundGuide('scene-world'), { y: 42 });
  assert.deepEqual(updateGroundGuide(initial, { y }), initial);
  assert.isFalse(groundGuideSchema.safeParse({ ...initial, y }).success);
});

test.each([undefined, null, '', '12', {}, { enabled: 1, y: 0, snapEnabled: false }])(
  'invalid external configuration %# is rejected',
  (input) => {
    assert.isFalse(groundGuideSchema.safeParse(input).success);
  },
);

test.each([0.35, 0.5, 1, 2, 4])('world guide covers the viewport and keeps pixel sizes at zoom %s', (zoom) => {
  const view = camera(zoom);
  const guide = updateGroundGuide(defaultGroundGuide('scene-world'), { enabled: true, y: 10 });
  const geometry = groundGuideGeometry(guide, view)!;
  // Independent forward projection of Phaser's origin-centered camera matrix.
  const screenX = (world: number) =>
    (world - view.scrollX - view.width * view.originX) * zoom + view.width * view.originX;
  assert.closeTo(screenX(geometry.left), 0, 1e-10);
  assert.closeTo(screenX(geometry.right), view.width, 1e-10);
  assert.closeTo(screenX(geometry.labelX), 12, 1e-10);
  assert.equal(geometry.y, guide.y);
  assert.closeTo(geometry.pixel * zoom, 1, 1e-10);
});

test('pan, pointer zoom, viewport resize and camera origin changes only alter projection', () => {
  const guide = updateGroundGuide(defaultGroundGuide('scene-world'), { enabled: true, y: 25 });
  const original = JSON.stringify(guide);
  const view = camera();
  const before = groundGuideGeometry(guide, view)!;
  panCamera(view, 100, 60);
  const panned = groundGuideGeometry(guide, view)!;
  assert.equal(panned.left, before.left - 100);
  assert.equal(panned.y, before.y);
  zoomCameraAt(view, 123, 234, -300);
  view.width = 1200;
  view.height = 900;
  view.originX = 0.3;
  view.originY = 0.25;
  const resized = groundGuideGeometry(guide, view)!;
  assert.closeTo((resized.right - resized.left) * view.zoom, 1200, 1e-10);
  assert.equal(resized.y, 25);
  assert.equal(JSON.stringify(guide), original);
});

test('hidden, offscreen and invalid viewports produce no guide geometry', () => {
  const view = camera();
  const defaults = defaultGroundGuide('scene-world');
  assert.isNull(groundGuideGeometry(defaults, view));
  const guide = updateGroundGuide(defaults, { enabled: true });
  assert.isNull(groundGuideGeometry({ ...guide, y: 1000 }, view));
  for (const patch of [{ zoom: 0 }, { zoom: NaN }, { width: 0 }, { height: -1 }, { scrollY: Infinity }])
    assert.isNull(groundGuideGeometry(guide, { ...view, ...patch }));
});

test('preferences round trip across reopen, isolate workspaces/domains and never write on bind', () => {
  const storage = memoryStorage();
  const workspace = new GroundGuideWorkspace('scene-world', () => storage);
  workspace.update({ enabled: true });
  assert.equal(storage.setItem.mock.calls.length, 0);
  workspace.bind('first');
  assert.equal(storage.setItem.mock.calls.length, 0);
  workspace.update({ enabled: true, y: 70, snapEnabled: true });
  const saved = workspace.getSnapshot();
  workspace.bind('second');
  assert.deepEqual(workspace.getSnapshot().guide, defaultGroundGuide('scene-world'));
  workspace.update({ y: -10 });
  workspace.bind('first');
  assert.strictEqual(workspace.getSnapshot(), saved);
  workspace.bind(null);
  assert.isNull(workspace.getSnapshot().workspaceId);
  assert.isFalse(workspace.getSnapshot().guide.enabled);
  const reopened = new GroundGuideWorkspace('scene-world', () => storage);
  reopened.bind('first');
  assert.deepEqual(reopened.getSnapshot().guide, saved.guide);
  const animation = new GroundGuideWorkspace('animation-preview-world', () => storage);
  animation.bind('first');
  assert.deepEqual(animation.getSnapshot().guide, defaultGroundGuide('animation-preview-world'));
  animation.update({ y: 600 });
  animation.resetY();
  assert.equal(animation.getSnapshot().guide.y, CHARACTER_PREVIEW_ORIGIN.y);
  assert.equal(reopened.getSnapshot().guide.y, 70);
});

test.each([
  '{invalid',
  JSON.stringify({ version: 2, guide: { enabled: true, y: 100, snapEnabled: false } }),
  '{"version":1,"guide":{"enabled":true,"y":1e999,"snapEnabled":false}}',
  JSON.stringify({ version: 1, guide: { enabled: true, y: '100', snapEnabled: false } }),
])('invalid stored preferences use defaults and retain original storage bytes: %#', (invalid) => {
  const storage = memoryStorage();
  const seed = new GroundGuideWorkspace('scene-world', () => storage);
  seed.bind('scene');
  seed.update({ y: 10 });
  const key = [...storage.values.keys()][0]!;
  storage.values.set(key, invalid);
  const reopened = new GroundGuideWorkspace('scene-world', () => storage);
  reopened.bind('scene');
  assert.deepEqual(reopened.getSnapshot().guide, defaultGroundGuide('scene-world'));
  assert.isNotEmpty(reopened.getSnapshot().persistenceMessage);
  assert.equal(storage.values.get(key), invalid);
});

test('unavailable storage retains independent session settings and reports the failure', () => {
  const workspace = new GroundGuideWorkspace('scene-world', () => {
    throw new Error('denied');
  });
  workspace.bind('first');
  assert.isNotEmpty(workspace.getSnapshot().persistenceMessage);
  workspace.update({ enabled: true, y: 123 });
  workspace.bind('other');
  assert.isFalse(workspace.getSnapshot().guide.enabled);
  workspace.bind('first');
  assert.equal(workspace.getSnapshot().guide.y, 123);
  assert.isNotEmpty(workspace.getSnapshot().persistenceMessage);
});

test('subscribers see stable immutable snapshots; invalid/no-op updates do not write or notify', () => {
  const storage = memoryStorage();
  const workspace = new GroundGuideWorkspace('scene-world', () => storage);
  const listener = vi.fn();
  const unsubscribe = workspace.subscribe(listener);
  workspace.bind('first');
  const initial = workspace.getSnapshot();
  workspace.update({ y: NaN });
  workspace.update({ enabled: false });
  workspace.bind('first');
  assert.strictEqual(workspace.getSnapshot(), initial);
  assert.equal(listener.mock.calls.length, 1);
  assert.equal(storage.setItem.mock.calls.length, 0);
  workspace.update({ y: 15 });
  assert.isTrue(Object.isFrozen(workspace.getSnapshot()));
  assert.equal(listener.mock.calls.length, 2);
  unsubscribe();
  workspace.resetY();
  assert.equal(listener.mock.calls.length, 2);
});

test('scene guide edits preserve authored exports, Actor positions, dirty flags and undo/redo', () => {
  const storage = memoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  const document = new SceneEditorDocument();
  const scene = {
    ...createEmptyScene({ id: 'first' }),
    actors: [{ id: 'hero', character: { manifest: '../characters/hero/character.json' }, position: { x: 20, y: 30 } }],
  };
  assert.isTrue(document.importJson(JSON.stringify(scene)));
  const original = document.exportJson();
  const snapshot = document.workingScene;
  document.groundGuide.update({ enabled: true, y: 100, snapEnabled: true });
  assert.equal(document.exportJson(), original);
  assert.strictEqual(document.workingScene, snapshot);
  assert.isFalse(document.dirty);
  assert.isFalse(document.canUndo);
  document.updateProperties({ name: 'Changed' });
  document.undo();
  assert.isTrue(document.canRedo);
  document.groundGuide.resetY();
  assert.isTrue(document.canRedo);
  document.createScene({ id: 'second' });
  assert.deepEqual(document.groundGuide.getSnapshot().guide, defaultGroundGuide('scene-world'));
  document.selectScene('first');
  assert.isTrue(document.groundGuide.getSnapshot().guide.enabled);
  const reopened = new SceneEditorDocument();
  reopened.importJson(original);
  assert.deepEqual(reopened.groundGuide.getSnapshot().guide, document.groundGuide.getSnapshot().guide);
});

test('shared controls start collapsed, have no-workspace guards and keep snapping optional', () => {
  const workspace = new GroundGuideWorkspace('scene-world', memoryStorage);
  let markup = renderToStaticMarkup(createElement(GroundGuideControls, { workspace }));
  assert.notInclude(markup, 'open=""');
  assert.include(markup, '<fieldset disabled="">');
  assert.notInclude(markup, 'Enable ground snapping');
  workspace.bind('first');
  markup = renderToStaticMarkup(createElement(GroundGuideControls, { workspace, showSnapping: true }));
  assert.notInclude(markup, 'disabled=""');
  assert.include(markup, 'Ground Y');
  assert.include(markup, 'Reset Ground Y');
  assert.include(markup, 'Enable ground snapping preference');
});

test('overlay hides, renders dashed/solid lines with constant pixel sizes and disposes independently', () => {
  const scene = puppetScene();
  const view = camera(2);
  Object.assign(scene, { cameras: { main: view } });
  const graphics = scene.add.graphics();
  const text = scene.add.text(0, 0, '');
  vi.spyOn(scene.add, 'graphics').mockReturnValue(graphics);
  vi.spyOn(scene.add, 'text').mockReturnValue(text);
  const lines = vi.spyOn(graphics, 'lineBetween');
  const style = vi.spyOn(graphics, 'lineStyle');
  const labelScale = vi.spyOn(text, 'setScale');
  const destroyGraphics = vi.spyOn(graphics, 'destroy');
  const destroyLabel = vi.spyOn(text, 'destroy');
  const overlay = new GroundGuideOverlay(scene);
  const guide = updateGroundGuide(defaultGroundGuide('scene-world'), { enabled: true });
  overlay.render(defaultGroundGuide('scene-world'));
  assert.isFalse(graphics.visible);
  assert.isFalse(text.visible);
  overlay.render(guide);
  assert.isTrue(graphics.visible);
  assert.isTrue(text.visible);
  assert.isAbove(lines.mock.calls.length, 1);
  assert.deepEqual(style.mock.lastCall, [1, 0xdba75d, 0.9]);
  assert.deepEqual(labelScale.mock.lastCall, [0.5]);
  const count = lines.mock.calls.length;
  overlay.render(guide);
  assert.equal(lines.mock.calls.length, count);
  overlay.render({ ...guide, enabled: false });
  assert.isFalse(graphics.visible);
  assert.isFalse(text.visible);
  overlay.dispose();
  overlay.dispose();
  overlay.render(guide);
  assert.equal(destroyGraphics.mock.calls.length, 1);
  assert.equal(destroyLabel.mock.calls.length, 1);
  const solid = new GroundGuideOverlay(scene, { dashed: false, showLabel: false });
  lines.mockClear();
  solid.render(guide);
  assert.equal(lines.mock.calls.length, 1);
  assert.isFalse(text.visible);
  solid.dispose();
});
