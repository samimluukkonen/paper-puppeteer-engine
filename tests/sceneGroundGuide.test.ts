import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { actorGroundOffset } from '../src/devtools/scene-editor/actorGrounding.js';
import { SceneActorPreview } from '../src/devtools/scene-editor/SceneActorPreview.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { SceneGroundHandle } from '../src/devtools/scene-editor/SceneGroundHandle.js';
import { SceneGroundPanel } from '../src/devtools/scene-editor/SceneGroundPanel.js';
import { stagePoint } from '../src/devtools/scene-editor/stageCoordinates.js';
import { editorWorldViewport, panCamera, zoomCameraAt } from '../src/devtools/shared/editorCamera.js';
import { groundGuideGeometry } from '../src/devtools/shared/groundGuide.js';
import { GUIDE_TARGETS } from '../src/devtools/shared/guides/anchors.js';
import { Actor } from '../src/engine/Actor.js';
import { serializeRigDefinition } from '../src/engine/authoredSerialization.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.unstubAllGlobals());

function fixture(zoom = 1) {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  vi.stubGlobal('window', { localStorage: storage });
  const document = new SceneEditorDocument();
  const scene = {
    ...createEmptyScene({ id: 'ground', duration: 2000 }),
    actors: [
      { id: 'a', character: { manifest: 'a/character.json' }, position: { x: -100, y: 20 } },
      { id: 'b', character: { manifest: 'b/character.json' }, position: { x: 200, y: -50 }, facing: 'left' },
    ],
    actions: [{ id: 'walk', actorId: 'a', type: 'move', time: 0, duration: 1000, destination: { x: 100, y: -80 } }],
  };
  assert.isTrue(document.importJson(JSON.stringify(scene)));
  const workspace = document.groundGuide;
  workspace.update({ enabled: true, y: 100 });
  document.setActorGroundOffsets(
    new Map([
      ['a', 35],
      ['b', 70],
    ]),
  );
  const camera = {
    width: 1000,
    height: 700,
    scrollX: -500,
    scrollY: -250,
    originX: 0.5,
    originY: 0.5,
    zoom,
    setZoom(value: number) {
      this.zoom = value;
    },
  };
  const bounds = { left: 100, top: 50, width: 500, height: 350 };
  const client = (world: { x: number; y: number }) => {
    const view = editorWorldViewport(camera)!;
    return {
      x: bounds.left + ((world.x - view.left) * camera.zoom * bounds.width) / camera.width,
      y: bounds.top + ((world.y - view.top) * camera.zoom * bounds.height) / camera.height,
    };
  };
  const label = () => {
    const geometry = groundGuideGeometry(workspace.getSnapshot().guide, camera)!;
    return { x: geometry.labelX + 5 / camera.zoom, y: geometry.labelY + 5 / camera.zoom };
  };
  return { document, workspace, storage, camera, bounds, client, label };
}

test.each([0.35, 0.5, 1, 2, 4])(
  'scene label drag uses current world coordinates at zoom %s and one guide Undo',
  (zoom) => {
    const f = fixture(zoom);
    const handle = new SceneGroundHandle(f.workspace);
    const authored = f.document.exportJson();
    const start = f.label();
    const writes = f.storage.setItem.mock.calls.length;
    assert.isTrue(handle.down(1, stagePoint(f.client(start), f.bounds, f.camera), f.camera));
    handle.move(2, { ...start, y: start.y + 70 });
    assert.equal(f.workspace.getSnapshot().guide.y, 100);
    handle.move(1, stagePoint(f.client({ ...start, y: start.y + 40 }), f.bounds, f.camera));
    assert.closeTo(f.workspace.getSnapshot().guide.y, 140, 1e-9);
    assert.equal(f.storage.setItem.mock.calls.length, writes);
    // Camera changes between input and pre-render must not use a stale Phaser matrix.
    panCamera(f.camera, 20, 30);
    zoomCameraAt(f.camera, 200, 150, -50);
    handle.up(1, stagePoint(f.client({ ...start, y: start.y + 60 }), f.bounds, f.camera));
    assert.closeTo(f.workspace.getSnapshot().guide.y, 160, 1e-9);
    assert.equal(f.storage.setItem.mock.calls.length, writes + 1);
    assert.isFalse(handle.dragging);
    f.workspace.undo();
    assert.equal(f.workspace.getSnapshot().guide.y, 100);
    f.workspace.redo();
    assert.closeTo(f.workspace.getSnapshot().guide.y, 160, 1e-9);
    assert.equal(f.document.exportJson(), authored);
    assert.isFalse(f.document.canUndo);
    assert.isFalse(f.document.dirty);
    handle.dispose();
  },
);

test('only the visible label captures ground gestures; cancellation and disposal retain data and release subscription', () => {
  const f = fixture();
  const handle = new SceneGroundHandle(f.workspace);
  const label = f.label();
  assert.isFalse(handle.down(1, { x: 0, y: 100 }, f.camera));
  f.workspace.update({ enabled: false });
  assert.isFalse(handle.down(1, label, f.camera));
  f.workspace.update({ enabled: true });
  const writes = f.storage.setItem.mock.calls.length;
  assert.isTrue(handle.down(1, label, f.camera));
  assert.isFalse(handle.down(2, label, f.camera));
  handle.move(1, { ...label, y: label.y + 50 });
  handle.up(2, label);
  assert.isTrue(handle.dragging);
  handle.cancel();
  assert.equal(f.workspace.getSnapshot().guide.y, 100);
  assert.equal(f.storage.setItem.mock.calls.length, writes);
  const release = vi.fn();
  const subscribe = f.workspace.subscribe;
  vi.spyOn(f.workspace, 'subscribe').mockImplementation((listener) => {
    const unsubscribe = subscribe(listener);
    return () => {
      release();
      unsubscribe();
    };
  });
  const owned = new SceneGroundHandle(f.workspace);
  owned.down(1, label, f.camera);
  owned.move(1, { ...label, y: label.y + 50 });
  owned.dispose();
  owned.dispose();
  assert.equal(release.mock.calls.length, 1);
  assert.equal(f.workspace.getSnapshot().guide.y, 100);
  assert.equal(f.storage.setItem.mock.calls.length, writes);
  assert.isFalse(owned.down(1, label, f.camera));
  handle.dispose();
});

test('switching or replacing scenes cancels unfinished ground gestures, including same-ID import', () => {
  const f = fixture();
  const original = f.document.exportJson();
  const handle = new SceneGroundHandle(f.workspace);
  const label = f.label();
  handle.down(1, label, f.camera);
  handle.move(1, { ...label, y: label.y + 70 });
  f.document.importJson(original);
  assert.isFalse(handle.dragging);
  assert.equal(f.workspace.getSnapshot().guide.y, 100);
  handle.down(1, label, f.camera);
  handle.move(1, { ...label, y: label.y + 70 });
  f.document.createScene({ id: 'other' });
  assert.isFalse(handle.dragging);
  handle.up(1, { ...label, y: label.y + 90 });
  assert.equal(f.workspace.getSnapshot().guide.y, 0);
  f.document.selectScene('ground');
  assert.equal(f.workspace.getSnapshot().guide.y, 100);
  handle.dispose();
});

test('explicit feet alignment authors only selected initial Y, with scene Undo/Redo and browser persistence on import', () => {
  const f = fixture();
  assert.isFalse(f.document.alignSelectedActorFeetToGround());
  f.document.selectActor('a');
  const initial = f.document.workingScene!;
  f.workspace.update({ enabled: false });
  assert.isFalse(f.document.alignSelectedActorFeetToGround());
  f.workspace.update({ enabled: true });
  assert.isTrue(f.document.alignSelectedActorFeetToGround());
  assert.deepEqual(f.document.workingScene!.actors[0]!.position, { x: -100, y: 65 });
  assert.deepEqual(f.document.workingScene!.actors[1], initial.actors[1]);
  assert.deepEqual(f.document.workingScene!.actions, initial.actions);
  assert.isTrue(f.document.dirty);
  f.document.undo();
  assert.deepEqual(f.document.workingScene, initial);
  f.workspace.update({ y: 150 });
  assert.isTrue(f.document.canRedo);
  f.document.redo();
  assert.equal(f.document.workingScene!.actors[0]!.position.y, 65, 'redo restores the authored Y, not the new guide Y');
  f.document.selectActor('b');
  f.document.alignSelectedActorFeetToGround();
  assert.deepEqual(f.document.workingScene!.actors[1]!.position, { x: 200, y: 80 });
  const json = f.document.exportJson();
  assert.notInclude(json, 'snapEnabled');
  const reopened = new SceneEditorDocument();
  assert.isTrue(reopened.importJson(json));
  assert.deepEqual(reopened.workingScene, f.document.workingScene);
  assert.deepEqual(reopened.groundGuide.getSnapshot().guide, f.workspace.getSnapshot().guide);
  assert.isFalse(reopened.canUndo);
});

test('feet drag snapping preserves X, allows Shift bypass and hidden/disabled guides, and groups scene Undo', () => {
  const f = fixture();
  f.workspace.update({ snapEnabled: true });
  const initial = f.document.workingScene!;
  assert.isTrue(f.document.beginActorDrag('a'));
  f.document.moveActorDrag({ x: 13, y: -300 });
  assert.deepEqual(f.document.workingScene!.actors[0]!.position, { x: 13, y: 65 });
  f.document.moveActorDrag({ x: 22, y: -250 }, { bypassGround: true });
  assert.deepEqual(f.document.workingScene!.actors[0]!.position, { x: 22, y: -250 });
  f.document.moveActorDrag({ x: 30, y: -200 });
  f.document.endActorDrag();
  assert.deepEqual(f.document.workingScene!.actors[0]!.position, { x: 30, y: 65 });
  assert.deepEqual(f.document.workingScene!.actions, initial.actions);
  f.document.undo();
  assert.deepEqual(f.document.workingScene, initial);
  f.document.redo();
  assert.equal(f.document.workingScene!.actors[0]!.position.x, 30);
  for (const patch of [{ enabled: false }, { enabled: true, snapEnabled: false }]) {
    f.workspace.update(patch);
    f.document.beginActorDrag('a');
    f.document.moveActorDrag({ x: 66, y: -42 });
    assert.deepEqual(f.document.workingScene!.actors[0]!.position, { x: 66, y: -42 });
    f.document.cancelActorDrag();
    assert.equal(f.document.workingScene!.actors[0]!.position.x, 30);
  }
});

function definition(rootY: number, artScale: number) {
  return CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: `character-${rootY}`,
      rig: 'rig.json',
      defaultSkin: 'plain',
      textures: { art: 'art.png' },
      skins: { plain: 'plain.json', tall: 'tall.json' },
      animations: ['initial.json'],
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [{ id: 'root', y: rootY }],
      slots: [{ id: 'body', bone: 'root' }],
      attachments: [
        {
          id: 'plain',
          texture: 'art',
          scaleX: artScale,
          scaleY: artScale,
          groundContacts: [
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
        },
        {
          id: 'tall',
          texture: 'art',
          scaleX: artScale,
          scaleY: artScale * 2,
          groundContacts: [
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
        },
      ],
    },
    skins: {
      'plain.json': { version: 1, name: 'plain', slots: { body: 'plain' } },
      'tall.json': { version: 1, name: 'tall', slots: { body: 'tall' } },
    },
    animations: {
      'initial.json': {
        version: 1,
        name: 'initial',
        duration: 100,
        loop: false,
        tracks: { root: [{ time: 0, y: rootY - 30 }] },
      },
    },
  });
}

test('feet alignment accounts for distinct rig origins, artwork sizes, skins, facing and Puppet scales', () => {
  const f = fixture();
  const definitions = new Map([
    ['a/character.json', definition(-60, 0.5)],
    ['b/character.json', definition(130, 2)],
  ]);
  f.document.updateActor('b', { skin: 'tall' });
  const preview = new SceneActorPreview(puppetScene());
  preview.sync(f.document.workingScene!, definitions);
  const original = JSON.stringify([...definitions.values()]);
  for (const [index, id] of ['a', 'b'].entries()) {
    const actor = preview.instances.get(id)!.actor;
    const scale = index === 0 ? 0.75 : 2;
    actor.puppet.container.setScale(scale);
    f.document.selectActor(id);
    f.document.setActorGroundOffsets(preview.groundOffsets());
    f.document.alignSelectedActorFeetToGround();
    preview.sync(f.document.workingScene!, definitions);
    assert.notEqual(actor.worldPosition.y, 100);
    assert.equal(actor.puppet.container.scaleY, scale);
    const rootY = actor.puppet.getBone('root').container.getWorldTransformMatrix().ty;
    assert.closeTo(rootY + (index === 0 ? 25 : 200) * scale, 100, 1e-9);
    assert.closeTo(actor.worldPosition.y + preview.groundOffsets().get(id)!, 100, 1e-9);
    assert.equal(actor.facingDirection, index === 0 ? 'right' : 'left');
  }
  assert.equal(preview.instances.get('b')!.actor.puppet.getAttachment('body'), 'tall');
  assert.equal(JSON.stringify([...definitions.values()]), original);
  const actors = [...preview.instances.values()].map(({ actor }) => actor);
  preview.dispose();
  assert.isTrue(actors.every((actor) => actor.isDisposed));
});

test('ground measurements refresh for the initial animation sample and a changed foot skin', () => {
  const f = fixture();
  const definitions = new Map([['a/character.json', definition(-60, 0.5)]]);
  const preview = new SceneActorPreview(puppetScene());
  preview.sync(f.document.workingScene!, definitions);
  assert.closeTo(preview.groundOffsets().get('a')!, -35, 1e-9);
  f.document.setActorAppearance('a', 'animation', 'initial');
  preview.sync(f.document.workingScene!, definitions);
  assert.closeTo(preview.groundOffsets().get('a')!, -65, 1e-9);
  f.document.setActorGroundOffsets(preview.groundOffsets());
  f.document.selectActor('a');
  f.document.alignSelectedActorFeetToGround();
  assert.closeTo(f.document.workingScene!.actors[0]!.position.y, 165, 1e-9);
  f.document.setActorAppearance('a', 'skin', 'tall');
  preview.sync(f.document.workingScene!, definitions);
  f.document.setActorGroundOffsets(preview.groundOffsets());
  f.document.alignSelectedActorFeetToGround();
  preview.sync(f.document.workingScene!, definitions);
  assert.closeTo(f.document.workingScene!.actors[0]!.position.y, 140, 1e-9);
  assert.closeTo(preview.instances.get('a')!.actor.position.y + preview.groundOffsets().get('a')!, 100, 1e-9);
  preview.dispose();
});

test('guide edits and drags preserve playback, authored movement, forward/backward seeks and scene history', () => {
  const f = fixture();
  const playback = new SceneEditorPlayback();
  const handle = new SceneGroundHandle(f.workspace);
  const created: Actor[] = [];
  const source = f.document.workingScene!;
  const createActor = (data: { id: string }) => {
    const actor = new Actor({
      id: data.id,
      puppet: new Puppet(puppetScene(), {
        autoUpdate: false,
        rig: { root: 'root', bones: [{ id: 'root' }] },
      }),
      puppetOwnership: 'owned',
    });
    created.push(actor);
    return actor;
  };
  const sync = () => playback.sync(f.document.workingScene, true, createActor);
  const unsubscribe = f.document.subscribe(sync);
  sync();
  playback.play();
  playback.update(500);
  assert.deepEqual(playback.actors!.get('a')!.position, { x: 0, y: -30 });
  const runtimeActor = playback.actors!.get('a');
  const label = f.label();
  handle.down(1, label, f.camera);
  handle.move(1, { ...label, y: label.y + 40 });
  handle.up(1, { ...label, y: label.y + 40 });
  f.workspace.update({ snapEnabled: true, y: 160 });
  assert.equal(playback.status, 'playing');
  assert.strictEqual(playback.actors!.get('a'), runtimeActor);
  assert.strictEqual(f.document.workingScene, source);
  playback.update(250);
  assert.deepEqual(playback.actors!.get('a')!.position, { x: 50, y: -55 });
  for (const time of [250, 900, 250]) {
    playback.seek(time);
    assert.closeTo(playback.actors!.get('a')!.position.y, 20 - time / 10, 1e-9);
    assert.equal(f.workspace.getSnapshot().guide.y, 160);
    assert.equal(groundGuideGeometry(f.workspace.getSnapshot().guide, f.camera)!.y, 160);
  }
  assert.isFalse(f.document.canUndo);
  assert.isFalse(f.document.dirty);
  unsubscribe();
  handle.dispose();
  playback.dispose();
  assert.isTrue(created.every((actor) => actor.isDisposed));
});

test('scene controls start collapsed, explain feet alignment, guard selection/visibility and disable alignment in preview', () => {
  const f = fixture();
  const playback = new SceneEditorPlayback();
  const markup = () => renderToStaticMarkup(createElement(SceneGroundPanel, { document: f.document, playback }));
  assert.notInclude(markup(), 'open=""');
  assert.include(markup(), 'Snap to Ground');
  assert.include(markup(), 'hold Shift');
  assert.include(markup(), `data-guide-id="${GUIDE_TARGETS.sceneGroundAlign}"`);
  assert.include(markup(), 'disabled="">Align Feet to Ground');
  f.document.selectActor('a');
  assert.notInclude(markup(), 'disabled="">Align Feet to Ground');
  f.workspace.update({ enabled: false });
  assert.include(markup(), 'disabled="">Align Feet to Ground');
  f.workspace.update({ enabled: true });
  playback.sync(
    f.document.workingScene,
    true,
    ({ id }) =>
      new Actor({
        id,
        puppet: new Puppet(puppetScene(), { rig: { root: 'root', bones: [{ id: 'root' }] }, autoUpdate: false }),
        puppetOwnership: 'owned',
      }),
  );
  playback.seek(500);
  assert.include(markup(), 'disabled="">Align Feet to Ground');
  playback.stop();
  assert.notInclude(markup(), 'disabled="">Align Feet to Ground');
  playback.dispose();
});

test('missing contacts disable alignment and leave snapping free; measurements stay outside authored history', () => {
  const f = fixture();
  f.document.setActorGroundOffsets(new Map());
  f.document.selectActor('a');
  assert.isFalse(f.document.canAlignSelectedActorFeetToGround);
  assert.isFalse(f.document.alignSelectedActorFeetToGround());
  assert.isFalse(f.document.dirty);
  assert.isFalse(f.document.canUndo);
  const playback = new SceneEditorPlayback();
  const markup = renderToStaticMarkup(createElement(SceneGroundPanel, { document: f.document, playback }));
  assert.include(markup, 'disabled="">Align Feet to Ground');
  assert.include(markup, 'No marker or legacy sole contact is available');
  f.workspace.update({ snapEnabled: true });
  f.document.beginActorDrag('a');
  f.document.moveActorDrag({ x: 15, y: -20 });
  assert.deepEqual(f.document.workingScene!.actors[0]!.position, { x: 15, y: -20 });
  f.document.cancelActorDrag();
  f.document.setActorGroundOffsets(
    new Map([
      ['a', NaN],
      ['b', Infinity],
    ]),
  );
  assert.isFalse(f.document.canAlignSelectedActorFeetToGround);
  f.document.setActorGroundOffsets(new Map([['a', 35]]));
  assert.isTrue(f.document.canAlignSelectedActorFeetToGround);
  f.workspace.beginDrag();
  assert.isFalse(f.document.alignSelectedActorFeetToGround());
  f.workspace.cancelDrag();
  assert.isFalse(f.document.dirty);
  assert.isFalse(f.document.canUndo);
  f.document.createScene({ id: 'another' });
  f.document.selectScene('ground');
  assert.isFalse(f.document.canAlignSelectedActorFeetToGround);
});

test('sole contacts follow image origins, slot and bone transforms; raised feet and props do not lower the floor', () => {
  const puppet = new Puppet(puppetScene(), {
    autoUpdate: false,
    rig: {
      root: 'hips',
      bones: [
        { id: 'hips', y: -50, rotation: 0.2, scaleX: 1.2, scaleY: 0.8 },
        { id: 'support', parent: 'hips', x: 20, y: 100, rotation: -0.35 },
        { id: 'raised', parent: 'hips', x: -20, y: 10 },
      ],
      slots: [
        { id: 'supportArt', bone: 'support', x: 4, y: 6, rotation: 0.4, scaleX: 0.7, scaleY: 1.3 },
        { id: 'raisedArt', bone: 'raised' },
        { id: 'sword', bone: 'hips', y: 500 },
      ],
      attachments: [
        {
          id: 'shoe',
          texture: 'art',
          x: 3,
          y: 5,
          rotation: -0.1,
          scaleX: -0.8,
          scaleY: 0.6,
          originX: 0.2,
          originY: 0.3,
          groundContacts: [
            { x: 0.1, y: 0.9 },
            { x: 0.8, y: 0.85 },
          ],
        },
        { id: 'prop', texture: 'art' },
      ],
      skins: [{ version: 1, name: 'plain', slots: { supportArt: 'shoe', raisedArt: 'shoe', sword: 'prop' } }],
    },
  });
  puppet.setSkin('plain');
  puppet.container.setPosition(200, -30).setScale(-1.4, 1.7).setRotation(0.15);
  const support = puppet.getSlotImage('supportArt')!;
  const matrix = support.getWorldTransformMatrix();
  const lowest = Math.max(matrix.transformPoint(-10, 60).y, matrix.transformPoint(60, 55).y);
  assert.closeTo(actorGroundOffset(puppet)!, lowest + 30, 1e-9);
  const offset = actorGroundOffset(puppet)!;
  puppet.container.setPosition(-500, 1000);
  assert.closeTo(actorGroundOffset(puppet)!, offset, 1e-9);
  support.setVisible(false);
  const raised = puppet.getSlotImage('raisedArt')!;
  const raisedMatrix = raised.getWorldTransformMatrix();
  assert.closeTo(
    actorGroundOffset(puppet)!,
    Math.max(raisedMatrix.transformPoint(-10, 60).y, raisedMatrix.transformPoint(60, 55).y) - 1000,
    1e-9,
  );
  raised.setAlpha(0);
  assert.isUndefined(actorGroundOffset(puppet));
  support.setVisible(true);
  puppet.container.setScale(0);
  assert.isUndefined(actorGroundOffset(puppet));
  puppet.destroy();
});

test('sole contact metadata validates, round-trips and remains deeply immutable', () => {
  const data = {
    version: 1,
    root: 'hips',
    bones: [{ id: 'hips' }],
    attachments: [
      {
        id: 'shoe',
        texture: 'art',
        groundContacts: [
          { x: 0.1, y: 0.95 },
          { x: 0.9, y: 0.95 },
        ],
      },
    ],
  };
  const parsed = parseRigDefinition(data);
  assert.deepEqual(parseRigDefinition(JSON.parse(serializeRigDefinition(data))), parsed);
  const rig = new Rig(parsed);
  assert.isTrue(Object.isFrozen(rig.getAttachment('shoe').groundContacts));
  assert.isTrue(Object.isFrozen(rig.getAttachment('shoe').groundContacts![0]));
  for (const contacts of [[], [{ x: -1, y: 1 }], [{ x: 0, y: Infinity }], [{ x: 0, y: 1, typo: true }]]) {
    assert.throws(() =>
      parseRigDefinition({ ...data, attachments: [{ ...data.attachments[0], groundContacts: contacts }] }),
    );
  }
});
