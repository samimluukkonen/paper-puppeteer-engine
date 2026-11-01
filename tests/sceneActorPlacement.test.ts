import { assert, expect, test, vi } from 'vitest';
import { SceneActorPreview } from '../src/devtools/scene-editor/SceneActorPreview.js';
import { SceneCharacterRegistry } from '../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { draggedPosition, stagePoint } from '../src/devtools/scene-editor/stageCoordinates.js';
import { panCamera, zoomCameraAt } from '../src/devtools/shared/editorCamera.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
const manifest = '../characters/arbitrary/character.json';
function character() {
  return CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'arbitrary-definition',
      rig: 'rig.json',
      defaultSkin: 'plain',
      skins: { plain: 'plain.json', alternate: 'alternate.json' },
      animations: ['wave.json'],
      textures: { art: 'art.png' },
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [{ id: 'root' }],
      slots: [{ id: 'hand', bone: 'root' }],
      attachments: [
        { id: 'plain-art', texture: 'art' },
        { id: 'alternate-art', texture: 'art' },
      ],
    },
    skins: {
      'plain.json': { version: 1, name: 'plain', slots: { hand: 'plain-art' } },
      'alternate.json': { version: 1, name: 'alternate', slots: { hand: 'alternate-art' } },
    },
    animations: {
      'wave.json': {
        version: 1,
        name: 'wave',
        duration: 100,
        loop: false,
        tracks: { root: [{ time: 0, x: 13 }] },
        events: [{ time: 0, name: 'gameplay' }],
      },
    },
  });
}
function fixture() {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'stage' });
  document.addActor(manifest);
  return { document, id: document.selectedActorId! };
}

test('add, duplicate, reorder and remove use unique scene-local identities and independent positions', () => {
  const { document, id } = fixture();
  document.addActor(manifest, { x: -100, y: 200 });
  const second = document.selectedActorId!;
  assert.notEqual(id, second);
  assert.deepEqual(
    document.workingScene!.actors.map((actor) => actor.character.manifest),
    [manifest, manifest],
  );
  document.duplicateActor(id);
  const copy = document.selectedActorId!;
  assert.deepEqual(document.workingScene!.actors[2]!.position, { x: 32, y: 32 });
  document.updateActor(copy, { position: { x: 999, y: 800 } });
  assert.deepEqual(document.workingScene!.actors[0]!.position, { x: 0, y: 0 });
  document.reorderActor(copy, -1);
  assert.deepEqual(
    document.workingScene!.actors.map((actor) => actor.id),
    [id, copy, second],
  );
  document.removeActor(copy);
  assert.isNull(document.selectedActorId);
  document.undo();
  assert.equal(document.workingScene!.actors[1]!.id, copy);
  document.redo();
  assert.equal(document.workingScene!.actors.length, 2);
  const snapshot = document.workingScene;
  assert.isFalse(document.updateActor(second, { id }));
  assert.strictEqual(document.workingScene, snapshot);
  assert.match(document.validationIssues[0]!.message, /Duplicate actor ID/);
});

test('rename updates action references atomically; referenced removal requires explicit action removal and is undoable', () => {
  const { document, id } = fixture();
  document.replaceScene({
    ...document.workingScene,
    actions: [{ id: 'face', type: 'face', actorId: id, time: 0, target: { type: 'direction', facing: 'left' } }],
  });
  document.updateActor(id, { id: 'hero' });
  assert.equal(document.actorReferences('hero').length, 1);
  assert.isFalse(document.removeActor('hero'));
  assert.equal(document.workingScene!.actors.length, 1);
  assert.isTrue(document.removeActor('hero', { removeActions: true }));
  assert.isEmpty(document.workingScene!.actions);
  document.undo();
  assert.equal(document.workingScene!.actions[0]!.actorId, 'hero');
  document.undo();
  assert.equal(document.workingScene!.actors[0]!.id, id);
  assert.equal(document.workingScene!.actions[0]!.actorId, id);
});

test('many drag updates are one history transaction; Escape cancellation preserves redo and source isolation', () => {
  const { document, id } = fixture();
  const source = document.sourceScene;
  document.markSaved();
  document.beginActorDrag(id);
  document.moveActorDrag({ x: 10, y: 20 });
  document.moveActorDrag({ x: -50.125, y: 300 });
  document.endActorDrag();
  assert.deepEqual(document.workingScene!.actors[0]!.position, { x: -50.125, y: 300 });
  document.undo();
  assert.deepEqual(document.workingScene!.actors[0]!.position, { x: 0, y: 0 });
  assert.isFalse(document.dirty);
  document.beginActorDrag(id);
  document.moveActorDrag({ x: 123, y: 321 });
  document.cancelActorDrag();
  assert.isTrue(document.canRedo);
  assert.deepEqual(document.workingScene!.actors[0]!.position, { x: 0, y: 0 });
  document.redo();
  assert.deepEqual(document.workingScene!.actors[0]!.position, { x: -50.125, y: 300 });
  assert.strictEqual(document.sourceScene, source);
  assert.isEmpty(source!.actors);
});

test('switching scenes cancels active movement before retaining independent histories', () => {
  const { document, id } = fixture();
  document.beginActorDrag(id);
  document.moveActorDrag({ x: 77, y: 88 });
  document.createScene({ id: 'other' });
  assert.isFalse(document.moveActorDrag({ x: 999, y: 999 }));
  document.selectScene('stage');
  assert.deepEqual(document.workingScene!.actors[0]!.position, { x: 0, y: 0 });
  document.undo();
  assert.isEmpty(document.workingScene!.actors);
});

test('coordinate conversion accounts for canvas FIT scale, centered zoom, pan, drag offset and axis handles', () => {
  const camera = {
    width: 1000,
    height: 700,
    zoom: 2,
    scrollX: -200,
    scrollY: 50,
    originX: 0.5,
    originY: 0.5,
    setZoom(zoom: number) {
      this.zoom = zoom;
    },
    getWorldPoint(x: number, y: number) {
      return {
        x: (x - this.width / 2) / this.zoom + this.width / 2 + this.scrollX,
        y: (y - this.height / 2) / this.zoom + this.height / 2 + this.scrollY,
      };
    },
  };
  const bounds = { left: 100, top: 50, width: 500, height: 350 };
  const start = stagePoint({ x: 350, y: 225 }, bounds, camera);
  assert.deepEqual(start, { x: 300, y: 400 });
  const current = stagePoint({ x: 400, y: 200 }, bounds, camera);
  assert.deepEqual(draggedPosition(start, { x: 10, y: 20 }, current, 'both'), { x: 60, y: -5 });
  assert.deepEqual(draggedPosition(start, { x: 10, y: 20 }, current, 'x'), { x: 60, y: 20 });
  assert.deepEqual(draggedPosition(start, { x: 10, y: 20 }, current, 'y'), { x: 10, y: -5 });
  const beforeZoom = stagePoint({ x: 400, y: 200 }, bounds, camera);
  zoomCameraAt(camera, 600, 300, -200);
  const afterZoom = stagePoint({ x: 400, y: 200 }, bounds, camera);
  assert.closeTo(afterZoom.x, beforeZoom.x, 1e-9);
  assert.closeTo(afterZoom.y, beforeZoom.y, 1e-9);
  panCamera(camera, 100, -50);
  const panned = stagePoint({ x: 400, y: 200 }, bounds, camera);
  assert.closeTo(panned.x, afterZoom.x - 100 / camera.zoom, 1e-9);
});

test('real Actor/Puppet previews share definitions but isolate placement, facing, skin, sampled pose and disposal', () => {
  const { document, id } = fixture();
  const definition = character();
  const before = JSON.stringify(definition);
  const definitions = new Map([[manifest, definition]]);
  const scene = puppetScene();
  const removeTexture = vi.fn();
  scene.textures.remove = removeTexture;
  const preview = new SceneActorPreview(scene);
  document.addActor(manifest, { x: 120, y: -50 });
  const secondId = document.selectedActorId!;
  document.updateActor(id, { facing: 'left', animation: 'wave', skin: 'alternate' });
  preview.sync(document.workingScene!, definitions);
  const first = preview.instances.get(id)!.actor;
  const second = preview.instances.get(secondId)!.actor;
  assert.notStrictEqual(first.puppet, second.puppet);
  assert.strictEqual(first.puppet.rig, second.puppet.rig);
  assert.equal(first.facingDirection, 'left');
  assert.equal(second.facingDirection, 'right');
  assert.equal(first.puppet.getBone('root').pose.x, 13);
  assert.equal(second.puppet.getBone('root').pose.x, 0);
  assert.equal(first.puppet.getAttachment('hand'), 'alternate-art');
  assert.equal(second.puppet.getAttachment('hand'), 'plain-art');
  assert.isTrue(first.puppet.animationPlayer.isPaused, 'initial pose is sampled without scene playback');
  document.updateActor(id, { position: { x: -210, y: 30 } });
  document.reorderActor(id, 1);
  preview.sync(document.workingScene!, definitions);
  assert.strictEqual(preview.instances.get(id)!.actor, first, 'ordinary React/document refresh keeps runtime objects');
  assert.deepEqual(first.position, { x: -210, y: 30 });
  assert.deepEqual(second.position, { x: 120, y: -50 });
  assert.equal(first.puppet.container.depth, 1);
  document.removeActor(id);
  preview.sync(document.workingScene!, definitions);
  assert.isTrue(first.isDisposed);
  assert.isTrue(first.puppet.isDestroyed);
  assert.isFalse(second.isDisposed);
  document.undo();
  preview.sync(document.workingScene!, definitions);
  const restored = preview.instances.get(id)!.actor;
  assert.notStrictEqual(first, restored);
  document.setActorAppearance(id, 'animation', null);
  document.setActorAppearance(id, 'skin', null);
  preview.sync(document.workingScene!, definitions);
  assert.equal(restored.puppet.getBone('root').pose.x, 0);
  assert.equal(restored.puppet.getAttachment('hand'), 'plain-art');
  document.createScene({ id: 'other' });
  preview.sync(document.workingScene!, definitions);
  assert.isTrue(second.isDisposed);
  assert.isTrue(restored.isDisposed);
  preview.dispose();
  preview.dispose();
  assert.isEmpty(preview.instances);
  assert.equal(removeTexture.mock.calls.length, 0, 'shared textures live until game destruction');
  assert.equal(JSON.stringify(definition), before);
});

test('registry deduplicates concurrent metadata loads and aborts late loads on page disposal', async () => {
  const definition = character();
  const loader = vi.fn(async () => definition);
  const registry = new SceneCharacterRegistry(loader);
  const first = registry.load(manifest);
  assert.strictEqual(first, registry.load(manifest));
  assert.strictEqual(await first, definition);
  assert.strictEqual(await registry.load(manifest), definition);
  assert.equal(loader.mock.calls.length, 1);
  registry.dispose();
  assert.isUndefined(registry.get(manifest));
  await expect(registry.load(manifest)).rejects.toThrow(/abort/i);
  let signal: AbortSignal | undefined;
  let resolve!: (definition: CharacterDefinition) => void;
  const pending = new SceneCharacterRegistry((_manifest, incoming) => {
    signal = incoming;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const loading = pending.load(manifest);
  await Promise.resolve();
  pending.dispose();
  assert.isTrue(signal!.aborted);
  resolve(definition);
  await expect(loading).rejects.toThrow(/abort/i);
  assert.isUndefined(pending.get(manifest));
});

test('preview updates only changed Actor fields and layer properties without resampling unchanged Actors', () => {
  const { document, id } = fixture();
  document.addActor(manifest, { x: 120, y: -50 });
  const secondId = document.selectedActorId!;
  const preview = new SceneActorPreview(puppetScene());
  const definitions = new Map([[manifest, character()]]);
  preview.sync(document.workingScene!, definitions);
  const first = preview.instances.get(id)!.actor;
  const second = preview.instances.get(secondId)!.actor;
  const observe = (actor: typeof first) => ({
    position: vi.spyOn(actor, 'setPosition'),
    facing: vi.spyOn(actor, 'setFacing'),
    skin: vi.spyOn(actor, 'setSkin'),
    pose: vi.spyOn(actor.puppet, 'syncPose'),
    depth: vi.spyOn(actor.puppet.container, 'setDepth'),
    visible: vi.spyOn(actor.puppet.container, 'setVisible'),
  });
  const firstCalls = observe(first);
  const secondCalls = observe(second);
  document.selectActor(id);
  assert.isEmpty(preview.sync(document.workingScene!, definitions));
  document.updateProperties({ name: 'Metadata edit' });
  assert.isEmpty(preview.sync(document.workingScene!, definitions));
  document.updateActor(id, { position: { x: 25, y: 40 } });
  assert.deepEqual([...preview.sync(document.workingScene!, definitions)], [id]);
  assert.equal(firstCalls.position.mock.calls.length, 1);
  assert.equal(firstCalls.facing.mock.calls.length, 0);
  assert.equal(firstCalls.skin.mock.calls.length, 0);
  assert.equal(firstCalls.depth.mock.calls.length, 0);
  assert.equal(firstCalls.visible.mock.calls.length, 0);
  for (const spy of Object.values(secondCalls)) assert.equal(spy.mock.calls.length, 0);
  const firstGround = vi.spyOn(first.puppet, 'getSlotImage');
  const secondGround = vi.spyOn(second.puppet, 'getSlotImage');
  preview.groundOffsets(new Set([id]));
  assert.equal(firstGround.mock.calls.length, 1);
  assert.equal(secondGround.mock.calls.length, 0, 'unchanged Actors skip grounding traversal');
  assert.deepEqual([...preview.groundContacts(new Set([id])).keys()], [id]);
  document.reorderActor(id, 1);
  assert.isEmpty(preview.sync(document.workingScene!, definitions), 'depth changes do not invalidate grounding');
  assert.equal(firstCalls.depth.mock.calls.length, 1);
  assert.equal(secondCalls.depth.mock.calls.length, 1);
  assert.equal(secondCalls.pose.mock.calls.length, 0);
  document.updateLayer('actors', { visible: false });
  assert.isEmpty(preview.sync(document.workingScene!, definitions));
  assert.equal(first.puppet.container.visible, false);
  assert.equal(second.puppet.container.visible, false);
  document.updateActor(id, { facing: 'left', skin: 'alternate', animation: 'wave' });
  assert.deepEqual([...preview.sync(document.workingScene!, definitions)], [id]);
  assert.equal(firstCalls.position.mock.calls.length, 1, 'appearance changes do not reapply placement');
  assert.equal(secondCalls.pose.mock.calls.length, 0);
  assert.equal(first.puppet.getBone('root').pose.x, 13);
  preview.dispose();
});

test('late and replaced character definitions reconcile only their dependent Actors', () => {
  const { document, id } = fixture();
  const otherManifest = '../characters/other/character.json';
  document.addActor(otherManifest);
  const otherId = document.selectedActorId!;
  const definitions = new Map([[manifest, character()]]);
  const preview = new SceneActorPreview(puppetScene());
  assert.deepEqual([...preview.sync(document.workingScene!, definitions)], [id]);
  const first = preview.instances.get(id)!.actor;
  const position = vi.spyOn(first, 'setPosition');
  definitions.set(otherManifest, character());
  assert.deepEqual([...preview.sync(document.workingScene!, definitions)], [otherId]);
  const other = preview.instances.get(otherId)!.actor;
  definitions.set(otherManifest, character());
  assert.deepEqual([...preview.sync(document.workingScene!, definitions)], [otherId]);
  assert.isTrue(other.isDisposed);
  assert.isFalse(first.isDisposed);
  assert.equal(position.mock.calls.length, 0);
  definitions.delete(otherManifest);
  assert.deepEqual([...preview.sync(document.workingScene!, definitions)], [otherId]);
  assert.isFalse(preview.instances.has(otherId));
  preview.dispose();
});

test('invalid initial assets release stale previews while valid actors still reconcile and recover', () => {
  const { document, id } = fixture();
  const definition = character();
  const definitions = new Map([[manifest, definition]]);
  document.addActor(manifest);
  const secondId = document.selectedActorId!;
  const preview = new SceneActorPreview(puppetScene());
  preview.sync(document.workingScene!, definitions);
  const old = preview.instances.get(id)!.actor;
  document.updateActor(id, { animation: 'missing' });
  assert.throws(() => preview.sync(document.workingScene!, definitions), /unknown animation/);
  assert.isTrue(old.isDisposed);
  assert.isFalse(preview.instances.get(secondId)!.actor.isDisposed);
  document.setActorAppearance(id, 'animation', null);
  preview.sync(document.workingScene!, definitions);
  assert.equal(preview.instances.size, 2);
  document.updateActor(id, { skin: 'missing' });
  assert.throws(() => preview.sync(document.workingScene!, definitions), /unknown skin/);
  preview.dispose();
});

test('changing initial appearance suppresses authored animation events and leaves no crossfade', () => {
  const { document, id } = fixture();
  const preview = new SceneActorPreview(puppetScene());
  const definitions = new Map([[manifest, character()]]);
  preview.sync(document.workingScene!, definitions);
  const actor = preview.instances.get(id)!.actor;
  const events = vi.fn();
  actor.puppet.onAnimationEvent(events);
  document.setActorAppearance(id, 'animation', 'wave');
  preview.sync(document.workingScene!, definitions);
  assert.equal(events.mock.calls.length, 0);
  assert.equal(actor.puppet.getBone('root').pose.x, 13);
  assert.isUndefined(actor.puppet.animationPlayer.transition);
  preview.dispose();
});

test('placement disposal releases every Actor and clears ownership even if one cleanup throws', () => {
  const { document, id } = fixture();
  document.addActor(manifest);
  const preview = new SceneActorPreview(puppetScene());
  preview.sync(document.workingScene!, new Map([[manifest, character()]]));
  const actors = [...preview.instances.values()].map(({ actor }) => actor);
  const first = preview.instances.get(id)!.actor;
  const dispose = first.dispose.bind(first);
  const failure = new Error('observer failed');
  vi.spyOn(first, 'dispose').mockImplementation(() => {
    dispose();
    throw failure;
  });
  assert.throws(() => preview.dispose(), /observer failed/);
  assert.isEmpty(preview.instances);
  assert.isTrue(actors.every((actor) => actor.isDisposed && actor.puppet.isDestroyed));
  assert.doesNotThrow(() => preview.dispose());
});

test('changing a character reference replaces only its Actor and retains independent source packages', () => {
  const { document, id } = fixture();
  document.addActor(manifest);
  const siblingId = document.selectedActorId!;
  const first = character();
  const second = character();
  const replacement = '../characters/replacement/character.json';
  const definitions = new Map([
    [manifest, first],
    [replacement, second],
  ]);
  const source = JSON.stringify([first, second]);
  const preview = new SceneActorPreview(puppetScene());
  preview.sync(document.workingScene!, definitions);
  const previous = preview.instances.get(id)!.actor;
  const sibling = preview.instances.get(siblingId)!.actor;
  document.updateActor(id, { character: { manifest: replacement }, animation: 'wave', skin: 'alternate' });
  preview.sync(document.workingScene!, definitions);
  assert.isTrue(previous.isDisposed && previous.puppet.isDestroyed);
  const next = preview.instances.get(id)!.actor;
  assert.notStrictEqual(next, previous);
  assert.strictEqual(next.puppet.rig, second.rig);
  assert.strictEqual(preview.instances.get(siblingId)!.actor, sibling);
  assert.isFalse(sibling.isDisposed);
  assert.equal(JSON.stringify([first, second]), source);
  preview.dispose();
});
