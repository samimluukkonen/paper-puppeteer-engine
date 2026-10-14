import { assert, test, vi } from 'vitest';
import { AttachmentController } from '../src/devtools/rig-editor/AttachmentController.js';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { artworkIssue } from '../src/devtools/shared/artwork/artworkIssue.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { SlotState } from '../src/engine/SlotState.js';
import type { RigDefinition, SkinDefinition } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const definition: RigDefinition = {
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'upper', parent: 'root', length: 20 },
    { id: 'lower', parent: 'upper', y: 20 },
    { id: 'hand', parent: 'lower', y: 15 },
  ],
  slots: [
    { id: 'hand-art', bone: 'hand', x: 3, depth: 20 },
    { id: 'hat', bone: 'root', depth: 40 },
  ],
  attachments: [
    { id: 'open', texture: 'hand.png', originX: 0.2, x: 7 },
    { id: 'grip', texture: 'grip.webp', rotation: 0.3, scaleX: 2 },
    { id: 'helmet', texture: 'helmet.png' },
  ],
  skins: [
    { version: 1, name: 'default', slots: { 'hand-art': 'open' } },
    { version: 1, name: 'helmet-only', slots: { hat: 'helmet' } },
  ],
  ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', enabled: false }],
};
const assetIssue = (key: string, frame?: string | number) =>
  !['hand.png', 'grip.webp', 'helmet.png'].includes(key)
    ? `Missing texture "${key}". Update character.json.`
    : frame !== undefined && frame !== 'valid' && frame !== 0
      ? 'Invalid frame. Choose an existing frame.'
      : undefined;
const stateFixture = () => new RigEditorState(new Rig(definition), undefined, { artworkIssue: assetIssue });

function previewFixture() {
  const scene = puppetScene();
  const puppet = new Puppet(scene, { rig: definition, skin: 'default', autoUpdate: false });
  const state = new RigEditorState(puppet.rig, undefined, { artworkIssue: assetIssue });
  const editor = new RigEditor(scene, puppet, vi.fn(), state);
  const controller = new AttachmentController();
  controller.bind(editor);
  editor.refresh();
  return { scene, puppet, state, editor, controller };
}

test('assignment, replacement, explicit removal and inheritance form separate undo operations', () => {
  const state = stateFixture();
  state.createSkin('alternate');
  assert.deepEqual(state.getSkin('alternate').slots, {});
  assert.equal(state.resolvedAttachment('hand-art'), 'open');
  state.assignAttachment('hand-art', 'grip');
  assert.equal(state.resolvedAttachment('hand-art'), 'grip');
  state.assignAttachment('hand-art', null);
  assert.isUndefined(state.resolvedAttachment('hand-art'));
  assert.deepEqual(state.getSkin('alternate').slots, { 'hand-art': null });
  state.assignAttachment('hand-art', undefined);
  assert.equal(state.resolvedAttachment('hand-art'), 'open');
  assert.deepEqual(state.getSkin('alternate').slots, {});
  state.undo();
  assert.isUndefined(state.resolvedAttachment('hand-art'));
  state.undo();
  assert.equal(state.resolvedAttachment('hand-art'), 'grip');
  state.redo();
  assert.isUndefined(state.resolvedAttachment('hand-art'));
  assert.equal(state.historyLength, 3);
});

test('skin switching is deterministic, partial and outside authored history', () => {
  const state = stateFixture();
  const before = state.workingCopy;
  for (let i = 0; i < 5; i++) {
    state.selectSkin('helmet-only');
    assert.equal(state.resolvedAttachment('hand-art'), 'open');
    assert.equal(state.resolvedAttachment('hat'), 'helmet');
    state.selectSkin('default');
    assert.isUndefined(state.resolvedAttachment('hat'));
  }
  assert.strictEqual(state.workingCopy, before);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
});

test('attachment IDs survive filename changes, serialization, undo and removal', () => {
  const state = stateFixture();
  const input = { id: 'hero-hand-closed', texture: 'grip.webp', frame: 0, originX: 0.125 };
  state.createAttachment(input);
  input.id = 'mutated';
  assert.equal(state.getAttachment('hero-hand-closed').texture, 'grip.webp');
  state.createSkin('custom');
  state.assignAttachment('hand-art', 'hero-hand-closed');
  const reloaded = parseRigDefinition(JSON.parse(state.exportJson(false)));
  assert.equal(reloaded.getAttachment('hero-hand-closed').originX, 0.125);
  assert.equal(reloaded.skins.find((skin) => skin.name === 'custom')?.slots['hand-art'], 'hero-hand-closed');
  assert.throws(() => state.removeAttachment('hero-hand-closed'), /custom\/hand-art/);
  state.assignAttachment('hand-art', undefined);
  state.removeAttachment('hero-hand-closed');
  assert.throws(() => state.getAttachment('hero-hand-closed'), /Unknown/);
  state.undo();
  assert.equal(state.getAttachment('hero-hand-closed').id, 'hero-hand-closed');
  state.redo();
  assert.throws(() => state.getAttachment('hero-hand-closed'), /Unknown/);
});

test('invalid creation, duplicate IDs, references and unsupported attachment types are atomic', () => {
  const state = stateFixture();
  const before = state.workingCopy;
  for (const input of [
    { id: 'open', texture: 'hand.png' },
    { id: 'new', texture: 'missing' },
    { id: 'new', texture: 'grip.webp', frame: 'bad' },
    { id: 'new', texture: 'blob:temporary' },
    { id: 'new', texture: '__paper_artwork_1_2' },
    { id: 'new', texture: 'hand.png', type: 'mesh' },
    { id: 'new', texture: 'hand.png', slot: 'missing' },
    { id: 'new', texture: 'hand.png', originX: 2 },
  ])
    assert.throws(() => state.createAttachment(input));
  assert.throws(() => state.assignAttachment('missing', 'open'), /Unknown slot/);
  assert.throws(() => state.assignAttachment('hat', 'missing'), /Unknown attachment/);
  assert.throws(() => state.selectSkin('missing'), /Unknown skin/);
  assert.throws(() => state.createSkin('default'), /Duplicate/);
  assert.strictEqual(state.workingCopy, before);
  assert.equal(state.historyLength, 0);
});

test('skin renaming preserves partial mappings; manifest names remain stable', () => {
  const state = stateFixture();
  state.createSkin('custom');
  state.assignAttachment('hat', 'helmet');
  state.renameSkin('custom', 'winter');
  assert.equal(state.activeSkin, 'winter');
  assert.deepEqual(state.getSkin('winter').slots, { hat: 'helmet' });
  state.undo();
  assert.deepEqual(state.getSkin('custom').slots, { hat: 'helmet' });
  state.redo();
  assert.equal(state.activeSkin, 'winter');
  assert.throws(() => state.renameSkin('default', 'another'), /manifest/);
});

test('standalone skins retain precedence, independent exports and dirty baselines', () => {
  const external: SkinDefinition[] = [{ version: 1, name: 'default', slots: { 'hand-art': 'grip' } }];
  const source = new Rig(definition);
  const state = new RigEditorState(source, undefined, { standaloneSkins: external, defaultSkin: 'default' });
  const original = JSON.stringify({ source, external });
  state.assignAttachment('hand-art', 'open');
  assert.isTrue(state.skinDirty('default'));
  assert.equal(state.resolvedAttachment('hand-art'), 'open');
  state.exportRig();
  assert.isTrue(state.dirty, 'rig export does not save a separate skin file');
  assert.deepEqual(JSON.parse(state.exportSkinJson('default')), {
    version: 1,
    name: 'default',
    slots: { 'hand-art': 'open' },
  });
  assert.isFalse(state.dirty);
  state.undo();
  assert.equal(state.resolvedAttachment('hand-art'), 'grip');
  assert.isTrue(state.dirty);
  state.redo();
  assert.isFalse(state.dirty);
  assert.equal(JSON.stringify({ source, external }), original);
  assert.throws(() => state.renameSkin('default', 'renamed'), /manifest/);
});

test('new embedded skins export even when the source rig omitted skins; recovery restores all documents', () => {
  const source = new Rig({ ...definition, skins: [] });
  const file = {
    version: 1 as const,
    root: source.root,
    bones: source.bones,
    slots: source.slots,
    attachments: source.attachments,
    ik: source.ik!,
  };
  const standaloneSkins: SkinDefinition[] = [{ version: 1, name: 'default', slots: { 'hand-art': 'open' } }];
  const options = { standaloneSkins, defaultSkin: 'default' };
  const state = new RigEditorState(source, file, options);
  assert.isUndefined(state.exportRig(false).skins);
  state.createAttachment({ id: 'new-hand', texture: 'grip.webp' });
  state.createSkin('custom');
  state.assignAttachment('hand-art', 'new-hand');
  state.assignAttachment('hat', 'helmet', 'default');
  assert.deepEqual(state.exportRig(false).skins, [{ version: 1, name: 'custom', slots: { 'hand-art': 'new-hand' } }]);
  const restored = new RigEditorState(source, file, options);
  assert.isTrue(restored.restoreDraft(JSON.parse(JSON.stringify(state.createRecoveryDraft()))));
  assert.equal(restored.historyLength, 1);
  assert.deepEqual(restored.workingCopy, state.workingCopy);
  assert.deepEqual(restored.standaloneSkins, state.standaloneSkins);
  restored.undo();
  assert.isFalse(restored.dirty);
  restored.redo();
  assert.isTrue(restored.dirty);
});

test('missing assets report errors without deleting authored references and block export', () => {
  const state = new RigEditorState(new Rig(definition), undefined, {
    artworkIssue: () => 'Missing texture. Update character.json.',
  });
  assert.equal(state.validationIssues().filter((issue) => issue.severity === 'error').length, 3);
  assert.equal(state.getSkin('default').slots['hand-art'], 'open');
  assert.throws(() => state.exportSkinJson('default'), /Missing texture/);
  assert.throws(() => state.exportRig(false), /Missing texture/);
  assert.throws(() => state.assignAttachment('hand-art', 'grip'), /Missing texture/);
});

test('runtime catalog updates validate atomically and own input data', () => {
  const slots = new SlotState(new Rig(definition));
  slots.setSkin('default');
  const next = [...definition.attachments!, { id: 'new', texture: 'grip.webp' }];
  slots.updateDefinitions(next, definition.skins!);
  next[3]!.texture = 'mutated';
  assert.equal(slots.getDefinition('new').texture, 'grip.webp');
  const previous = slots.getDefinition('open');
  slots.updateDefinitions(definition.attachments!, definition.skins!);
  assert.strictEqual(slots.getDefinition('open'), previous);
  assert.throws(() => slots.updateDefinitions([], []), /Clear assigned/);
  assert.throws(
    () => slots.updateDefinitions(definition.attachments!, [{ version: 1, name: 'bad', slots: { missing: 'open' } }]),
    /unknown slot/,
  );
  assert.strictEqual(slots.getDefinition('open'), previous);
  assert.equal(slots.getAttachment('hand-art'), 'open');
});

test('preview authoring and skin switching preserve player, IK, bone pose, facing, mounts and depth', () => {
  const { puppet, state, editor, controller } = previewFixture();
  controller.selectSlot('hand-art');
  const bones = definition.bones.map((bone) => puppet.getBone(bone.id));
  const ik = puppet.getIK('arm');
  puppet.addAnimation({
    name: 'motion',
    duration: 1000,
    loop: true,
    tracks: {
      upper: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 0.8 },
      ],
    },
  });
  puppet.play('motion');
  puppet.update(450);
  puppet.setFacing('left');
  const pose = bones.map((bone) => ({ ...bone.pose }));
  const image = puppet.getSlotImage('hand-art')!;
  const mount = image.parentContainer;
  const order = puppet.getRenderOrder();
  const player = puppet.animationPlayer;
  const prepare = vi.spyOn(puppet, 'preparePose');
  controller.assign('grip');
  assert.equal(puppet.getAttachment('hand-art'), 'grip');
  assert.strictEqual(puppet.getSlotImage('hand-art')!.parentContainer, mount);
  controller.createSkin('custom');
  controller.assign(null);
  assert.isUndefined(puppet.getSlotImage('hand-art'));
  controller.assign(undefined);
  controller.selectSkin('helmet-only');
  assert.equal(puppet.getAttachment('hat'), 'helmet');
  controller.selectSkin('default');
  assert.isUndefined(puppet.getAttachment('hat'));
  editor.undo();
  editor.redo();
  assert.equal(prepare.mock.calls.length, 0, 'artwork changes never restore bone transforms');
  assert.strictEqual(puppet.animationPlayer, player);
  assert.equal(player.elapsedTime, 450);
  assert.isTrue(player.isPlaying);
  assert.strictEqual(puppet.getIK('arm'), ik);
  assert.deepEqual(
    bones.map((bone) => bone.pose),
    pose,
  );
  assert.strictEqual(puppet.getRenderOrder(), order);
  assert.equal(mount.parentContainer.parentContainer.depth, 20);
  assert.equal(puppet.container.scaleX, -1);
  assert.deepEqual(state.selection, { type: 'slot', id: 'hand-art' });
  controller.dispose();
  puppet.destroy();
});

test('runtime catalog edits refresh same-ID geometry while retaining mount, visibility and image depth', () => {
  const scene = puppetScene();
  const puppet = new Puppet(scene, { rig: definition, skin: 'default', autoUpdate: false });
  const original = puppet.getSlotImage('hand-art')!;
  const mount = original.parentContainer;
  original.setVisible(false).setAlpha(0.4).setDepth(9);
  puppet.updateSlotDefinitions(
    definition.attachments!.map((entry) => (entry.id === 'open' ? { ...entry, x: 17, originX: 0.75 } : entry)),
    definition.skins!,
  );
  const image = puppet.getSlotImage('hand-art')!;
  assert.strictEqual(image.parentContainer, mount);
  assert.equal(image.x, 17);
  assert.equal(image.originX, 0.75);
  assert.isFalse(image.visible);
  assert.equal(image.alpha, 0.4);
  assert.equal(image.depth, 9);
  puppet.destroy();
});

test.each([
  { id: 'open', texture: 'missing', frame: undefined, error: /Missing texture/ },
  { id: 'helmet', texture: 'missing', frame: undefined, error: /Missing texture/ },
  { id: 'open', texture: 'hand.png', frame: 'missing', error: /Missing frame/ },
  { id: 'helmet', texture: 'helmet.png', frame: 99, error: /Missing frame/ },
])('runtime catalog rejects unavailable artwork for $id ($texture, $frame) before changing state', (invalid) => {
  const scene = puppetScene();
  scene.textures.exists = (key) => ['hand.png', 'grip.webp', 'helmet.png'].includes(key);
  scene.textures.get = vi.fn(() => ({
    has: (frame: string) => frame === '0' || frame === 'valid',
  })) as unknown as typeof scene.textures.get;
  const puppet = new Puppet(scene, { rig: definition, skin: 'default', autoUpdate: false });
  const original = puppet.getSlotImage('hand-art')!;
  const next = definition.attachments!.map((entry) =>
    entry.id === invalid.id
      ? { ...entry, texture: invalid.texture, ...(invalid.frame === undefined ? {} : { frame: invalid.frame }) }
      : { ...entry, x: 17 },
  );
  const skins: SkinDefinition[] = [...definition.skins!, { version: 1, name: 'new', slots: { 'hand-art': 'grip' } }];
  assert.throws(() => puppet.updateSlotDefinitions(next, skins), invalid.error);
  assert.strictEqual(puppet.getSlotImage('hand-art'), original);
  assert.isFalse(original.isDestroyed);
  assert.equal(puppet.getAttachment('hand-art'), 'open');
  assert.equal(original.x, 7);
  assert.throws(() => puppet.setSkin('new'), /Unknown skin/);
  puppet.setAttachment('hand-art', 'grip');
  assert.equal(puppet.getSlotImage('hand-art')!.texture.key, 'grip.webp');
  puppet.destroy();
});

test.each(['allocation', 'configuration'] as const)(
  'failed image %s retains the previous catalog and image',
  (stage) => {
    const scene = puppetScene();
    const puppet = new Puppet(scene, { rig: definition, skin: 'default', autoUpdate: false });
    const original = puppet.getSlotImage('hand-art')!;
    const image = scene.add.image.bind(scene.add);
    let disposedCandidate = false;
    const create = vi.spyOn(scene.add, 'image').mockImplementationOnce((...args) => {
      if (stage === 'allocation') throw new Error('Image allocation failed');
      const candidate = image(...args);
      vi.spyOn(candidate, 'setOrigin').mockImplementationOnce(() => {
        throw new Error('Image configuration failed');
      });
      const destroy = candidate.destroy.bind(candidate);
      candidate.destroy = () => {
        disposedCandidate = true;
        destroy();
      };
      return candidate;
    });
    const next = definition.attachments!.map((entry) => ({ ...entry, x: 17 }));
    assert.throws(() => puppet.updateSlotDefinitions(next, definition.skins!), /Image .* failed/);
    assert.strictEqual(puppet.getSlotImage('hand-art'), original);
    assert.isFalse(original.isDestroyed);
    assert.equal(original.x, 7);
    assert.equal(disposedCandidate, stage === 'configuration');
    create.mockRestore();
    puppet.updateSlotDefinitions(next, definition.skins!);
    assert.equal(puppet.getSlotImage('hand-art')!.x, 17);
    puppet.destroy();
  },
);

test('a failure after replacing an earlier slot restores all catalog entries and visible slots', () => {
  const scene = puppetScene();
  const puppet = new Puppet(scene, { rig: definition, skin: 'default', autoUpdate: false });
  puppet.applySkin('helmet-only');
  const oldHand = puppet.getSlotImage('hand-art')!;
  const oldHat = puppet.getSlotImage('hat')!;
  const image = scene.add.image.bind(scene.add);
  const create = vi
    .spyOn(scene.add, 'image')
    .mockImplementationOnce(image)
    .mockImplementationOnce(() => {
      throw new Error('Second slot failed');
    });
  const next = definition.attachments!.map((entry) => ({ ...entry, x: 17 }));
  assert.throws(() => puppet.updateSlotDefinitions(next, definition.skins!), /Second slot failed/);
  assert.isTrue(oldHand.isDestroyed);
  assert.equal(puppet.getSlotImage('hand-art')!.x, 7);
  assert.strictEqual(puppet.getSlotImage('hat'), oldHat);
  assert.isFalse(oldHat.isDestroyed);
  assert.equal(puppet.getAttachment('hand-art'), 'open');
  assert.equal(puppet.getAttachment('hat'), 'helmet');
  create.mockRestore();
  puppet.clearAttachment('hand-art');
  puppet.setSkin('default');
  assert.equal(puppet.getSlotImage('hand-art')!.x, 7);
  puppet.destroy();
});

test('texture/frame lookup checks real availability rather than Phaser placeholders', () => {
  const scene = puppetScene();
  scene.textures.exists = (key) => key === 'loaded';
  scene.textures.get = vi.fn(() => ({
    has: (frame: string) => frame === '0' || frame === 'valid',
  })) as unknown as typeof scene.textures.get;
  assert.match(artworkIssue(scene.textures, 'missing')!, /character.json/);
  assert.match(artworkIssue(scene.textures, 'loaded', 'bad')!, /Invalid frame/);
  assert.isUndefined(artworkIssue(scene.textures, 'loaded', 0));
  assert.isUndefined(artworkIssue(scene.textures, 'loaded'));
});
