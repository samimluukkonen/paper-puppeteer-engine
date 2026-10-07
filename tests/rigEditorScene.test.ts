import Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { demoIK } from '../src/demo/demoIK.js';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorScene } from '../src/devtools/rig-editor/RigEditorScene.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { parseRigDefinition, type RigJsonDefinition } from '../src/engine/externalData.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import type { TwoBoneIKDefinition } from '../src/engine/ik/types.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { rigDefinitionSchema } from '../src/engine/schemas.js';
import { SlotState } from '../src/engine/SlotState.js';
import type { RigDefinition } from '../src/engine/types.js';
import { EditorElement, stubRigEditorDom } from './helpers/rigEditorDom.js';

vi.mock('phaser', () => ({
  default: {
    Game: vi.fn(),
    Scale: { FIT: 0, CENTER_BOTH: 0 },
    Scene: class {
      input = { on: vi.fn(), off: vi.fn() };
      events = { on: vi.fn(), off: vi.fn() };
    },
    Scenes: { Events: { UPDATE: 'update' } },
  },
}));

vi.mock('../src/engine/Puppet.js', () => ({
  Puppet: vi.fn(
    class {
      readonly rig: Rig;
      private readonly joints: Map<string, Joint>;
      private readonly constraints = new Map<string, TwoBoneIKConstraint>();
      private readonly slots: SlotState;
      destroy = vi.fn();
      constructor(_scene: unknown, options: { rig: RigDefinition; skin?: string }) {
        this.rig = new Rig(options.rig);
        this.slots = new SlotState(this.rig);
        if (options.skin) this.slots.setSkin(options.skin);
        this.joints = new Map(
          this.rig.bones.map((bone) => [
            bone.id,
            Object.assign(
              new Joint(bone.id, bone),
              { getWorldPosition: () => ({ x: 0, y: 40 }) },
              bone.sprite
                ? {
                    sprite: {
                      alpha: 1,
                      setPosition: vi.fn().mockReturnThis(),
                      setOrigin: vi.fn().mockReturnThis(),
                      setAlpha(alpha: number) {
                        this.alpha = alpha;
                        return this;
                      },
                    },
                  }
                : {},
            ),
          ]),
        );
      }
      getBone(id: string) {
        return this.joints.get(id)!;
      }
      getAttachment(id: string) {
        return this.slots.getAttachment(id);
      }
      getSlotImage() {
        return undefined;
      }
      setSlotTransform = vi.fn();
      preparePose = vi.fn();
      syncPose = vi.fn();
      setRenderOrder = vi.fn();
      resetToBindPose() {
        return this;
      }
      setFacing() {
        return this;
      }
      addIK(chain: TwoBoneIKDefinition) {
        const constraint = new TwoBoneIKConstraint(chain, this.rig, this.joints);
        this.constraints.set(constraint.name, constraint);
        return constraint;
      }
      getIK(name: string) {
        const constraint = this.constraints.get(name);
        if (!constraint) throw new Error(`Unknown IK "${name}".`);
        return constraint;
      }
    },
  ),
}));

vi.mock('../src/devtools/rig-editor/RigEditorOverlay.js', () => ({
  RigEditorOverlay: class {
    invalidate() {}
    draw() {}
    destroy = vi.fn();
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test('rig export filenames decode manifest URLs while imported filenames retain their literal spelling', () => {
  const scene = new RigEditorScene(vi.fn(), vi.fn());
  assert.equal(scene.rigFilename, 'rig.json');
  Reflect.set(scene, 'definition', { rigPath: 'rigs/rig%20v2.json?revision=2#asset' });
  assert.equal(scene.rigFilename, 'rig v2.json');
  Reflect.set(scene, 'loadedFilename', 'imported%20rig.json');
  assert.equal(scene.rigFilename, 'imported%20rig.json');
});

test.each(['matching', 'rig-only', 'absent'] as const)(
  'preview merges standalone skins with %s embedded skins while exports preserve authored skins',
  (kind) => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const file: RigJsonDefinition = {
      version: 1,
      root: 'root',
      bones: [{ id: 'root' }],
      slots: [{ id: 'visual', bone: 'root' }],
      attachments: [{ id: 'art', texture: 'part' }],
      ...(kind === 'absent'
        ? {}
        : { skins: [{ version: 1, name: kind === 'matching' ? 'default' : 'embedded', slots: { visual: null } }] }),
    };
    const definition = CharacterDefinition.fromData({
      manifest: {
        version: 1,
        id: 'test',
        rig: 'rig.json',
        defaultSkin: 'default',
        skins: { default: 'skin.json' },
        textures: { part: 'part.png' },
        animations: [],
      },
      rig: file,
      skins: { 'skin.json': { version: 1, name: 'default', slots: { visual: 'art' } } },
    });
    const scene = new RigEditorScene(vi.fn(), vi.fn());
    Reflect.set(scene, 'definition', definition);
    for (const load of [() => scene.reloadRig(file), () => scene.reloadOriginal()]) {
      load();
      const puppet = vi.mocked(Puppet).mock.results.at(-1)!.value as Puppet;
      assert.strictEqual(puppet.rig.bones, scene.editor!.state.rig.bones);
      assert.equal(puppet.getAttachment('visual'), 'art');
      assert.deepEqual(puppet.rig.skins, definition.rig.skins);
      assert.deepEqual(scene.editor!.exportRig(false).skins, file.skins);
    }
    const parse = vi.spyOn(rigDefinitionSchema, 'parse');
    scene.reloadOriginal();
    assert.equal(parse.mock.calls.length, 0, 'original reload reuses the validated character skeleton');
    assert.strictEqual(scene.editor!.state.rig.bones, definition.rig.bones);
    parse.mockRestore();
    const editor = scene.editor;
    assert.throws(() => scene.reloadRig({ ...file, attachments: [] }), /unknown attachment/i);
    assert.strictEqual(scene.editor, editor, 'incompatible standalone skins preserve the working session');
    assert.deepEqual(file.skins, definition.rigFile!.skins);
  },
);

function fixture(sceneOverride?: RigEditorScene) {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => true) });
  const file: RigJsonDefinition = {
    version: 1,
    root: 'root',
    bones: [
      { id: 'root', sprite: { texture: 'body' } },
      ...demoIK.flatMap((chain) => [
        { id: chain.rootBone, parent: 'root' },
        { id: chain.middleBone, parent: chain.rootBone, y: 20 },
        { id: chain.endBone, parent: chain.middleBone, y: 20 },
      ]),
    ],
    skins: [{ version: 1, name: 'default', slots: {} }],
  };
  const onReady = vi.fn();
  const scene = sceneOverride ?? new RigEditorScene(onReady, vi.fn(), { ikChains: demoIK });
  Reflect.set(scene, 'definition', {
    id: 'test-character',
    defaultSkin: 'default',
    rig: parseRigDefinition(file),
    rigFile: file,
    rigPath: '/character/original.json',
  });
  scene.reloadRig(file, 'working.json');
  const editor = scene.editor!;
  if (!sceneOverride) editor.state.editBone('root', 'x', 12);
  const disable = vi.spyOn(editor, 'disable');
  const puppet = vi.mocked(Puppet).mock.results[0]!.value as Puppet;
  onReady.mockClear();
  const assertPreserved = () => {
    assert.strictEqual(scene.editor, editor);
    assert.equal(scene.rigFilename, 'working.json');
    assert.equal(editor.state.getBone('root').x, 12);
    assert.isTrue(editor.state.dirty);
    assert.isTrue(editor.state.canUndo);
    assert.equal(disable.mock.calls.length, 0);
    assert.equal(vi.mocked(puppet).destroy.mock.calls.length, 0);
    assert.equal(onReady.mock.calls.length, 0);
  };
  return { scene, file, editor, puppet, onReady, disable, assertPreserved };
}

test.each(demoIK)('rejects a valid rig with a disconnected $name chain before creating a replacement', (chain) => {
  const { scene, file, assertPreserved } = fixture();
  const incompatible = structuredClone(file);
  incompatible.bones.find((bone) => bone.id === chain.middleBone)!.parent = 'root';
  // The import is valid rig data; only the preview hierarchy is incompatible.
  parseRigDefinition(incompatible);
  assert.throws(() => scene.reloadRig(incompatible, 'incompatible.json'), /three directly connected bones/);
  assert.equal(vi.mocked(Puppet).mock.calls.length, 1);
  assertPreserved();
});

test.each([false, true])('accepts a different character with optional custom preview chains (IK: %s)', (withIK) => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const chains: TwoBoneIKDefinition[] = withIK
    ? [{ name: 'arm', rootBone: 'shoulder', middleBone: 'elbow', endBone: 'hand' }]
    : [];
  const onReady = vi.fn();
  const scene = new RigEditorScene(onReady, vi.fn(), withIK ? { ikChains: chains } : {});
  // Scene configuration is owned independently of the caller's array and definitions.
  if (withIK) {
    chains[0]!.rootBone = 'missing';
    chains.length = 0;
  }
  const file: RigJsonDefinition = {
    version: 1,
    root: 'body',
    bones: [
      { id: 'body' },
      { id: 'shoulder', parent: 'body' },
      { id: 'elbow', parent: 'shoulder', y: 20 },
      { id: 'hand', parent: 'elbow', y: 20 },
    ],
    skins: [{ version: 1, name: 'default', slots: {} }],
  };
  Reflect.set(scene, 'definition', {
    id: 'custom-character',
    defaultSkin: 'default',
    rig: parseRigDefinition(file),
    rigFile: file,
  });
  scene.reloadRig(file, 'custom.json');
  const puppet = vi.mocked(Puppet).mock.results[0]!.value as Puppet;
  assert.equal(scene.characterId, 'custom-character');
  assert.equal(scene.editor!.state.rig.root, 'body');
  assert.equal(scene.rigFilename, 'custom.json');
  assert.deepEqual(onReady.mock.calls, [[scene.editor]]);
  if (withIK) {
    const constraint = puppet.getIK('arm');
    assert.equal(constraint.rootBone, 'shoulder');
    assert.isFalse(constraint.enabled);
    scene.editor!.setIKPreview(true);
    assert.isTrue(constraint.enabled);
    assert.deepEqual(constraint.target, { x: 0, y: 40 });
    scene.editor!.setIKPreview(false);
    assert.isFalse(constraint.enabled);
  } else {
    assert.throws(() => puppet.getIK('arm'), /Unknown IK/);
    scene.editor!.setIKPreview(true);
    assert.isTrue(scene.editor!.state.ikPreview);
  }
});

test('rejects missing preview bones without replacing the working session', () => {
  const { scene, file, assertPreserved } = fixture();
  const incompatible = structuredClone(file);
  incompatible.bones = incompatible.bones.filter((bone) => bone.id !== 'rightFoot');
  parseRigDefinition(incompatible);
  assert.throws(() => scene.reloadRig(incompatible, 'missing-bone.json'), /Unknown bone "rightFoot"/);
  assert.equal(vi.mocked(Puppet).mock.calls.length, 1);
  assertPreserved();
});

test.each(['reloadRig', 'reloadOriginal'] as const)('%s cleans up a replacement that fails during enable', (method) => {
  const { scene, file, assertPreserved } = fixture();
  const failure = new Error('Overlay draw failed');
  let replacementOverlay: RigEditorOverlay | undefined;
  const draw = vi.spyOn(RigEditorOverlay.prototype, 'draw');
  draw.mockImplementationOnce(function (this: RigEditorOverlay) {
    // oxlint-disable-next-line typescript/no-this-alias -- Capture the receiver for lifecycle assertions after the callback.
    replacementOverlay = this;
    throw failure;
  });
  const input = vi.mocked(scene.input);
  assert.throws(() => {
    if (method === 'reloadRig') scene.reloadRig(file, 'replacement.json');
    else scene.reloadOriginal();
  }, /Overlay draw failed/);
  const replacement = vi.mocked(Puppet).mock.results[1]!.value as Puppet;
  assert.equal(vi.mocked(replacement).destroy.mock.calls.length, 1);
  assert.equal(vi.mocked(replacementOverlay!).destroy.mock.calls.length, 1);
  assert.deepEqual(
    input.off.mock.calls.map(([event]) => event),
    ['pointerdown', 'pointermove', 'pointerup', 'pointerupoutside', 'wheel'],
  );
  assert.equal(vi.mocked(scene.events).off.mock.calls[0]?.[0], 'update');
  assert.equal(vi.mocked(window.removeEventListener).mock.calls[0]?.[0], 'keydown');
  assertPreserved();
});

test('replaces the session only after the new editor enables successfully', () => {
  const { scene, file, editor, puppet, onReady, disable } = fixture();
  // oxlint-disable-next-line typescript/unbound-method -- The test deliberately reuses this method with an explicit fixture receiver.
  const enable = RigEditor.prototype.enable;
  vi.spyOn(RigEditor.prototype, 'enable').mockImplementationOnce(function (this: RigEditor) {
    assert.strictEqual(scene.editor, editor);
    assert.equal(disable.mock.calls.length, 0);
    assert.equal(vi.mocked(puppet).destroy.mock.calls.length, 0);
    enable.call(this);
  });
  scene.reloadRig(file, 'replacement.json');
  assert.notStrictEqual(scene.editor, editor);
  assert.equal(scene.rigFilename, 'replacement.json');
  assert.equal(disable.mock.calls.length, 1);
  assert.equal(vi.mocked(puppet).destroy.mock.calls.length, 1);
  assert.deepEqual(onReady.mock.calls, [[scene.editor]]);
});

async function panelFixture() {
  const element = stubRigEditorDom();
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.resetModules();
  await import('../src/devtools/rig-editor/main.js');
  const scene = vi.mocked(Phaser.Game).mock.lastCall![0]!.scene as RigEditorScene[];
  return { ...fixture(scene[0]), element };
}

async function editNumber(element: ReturnType<typeof stubRigEditorDom>, bone: string, field: string, values: number[]) {
  const button = element('#hierarchy').children.find((child) => child.textContent === bone)!;
  await button.click();
  const input = new EditorElement();
  input.type = 'number';
  input.dataset = { scope: 'bone', field };
  const inspector = element('#inspector');
  await inspector.dispatch('focusin', input);
  for (const value of values) {
    input.value = String(value);
    await inspector.dispatch('input', input);
  }
  await inspector.dispatch('change', input);
  await inspector.dispatch('focusout', input);
}

test.each(['original', 'exported', 'imported'] as const)(
  'visibility controls update the active editor after reloading the %s rig',
  async (source) => {
    const { scene, editor, file, element } = await panelFixture();
    const controls = element('#visibility').querySelectorAll('input');
    const artwork = controls.find((input) => input.dataset.visibility === 'artwork')!;
    artwork.checked = false;
    await artwork.dispatch('change');
    assert.isFalse(editor.state.visibility.artwork);
    const opacity = element('#opacity');
    opacity.value = '0.25';
    await opacity.dispatch('change');
    assert.equal(editor.state.artworkOpacity, 0.25);

    if (source === 'exported') {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await element('#log-json').click();
      await element('#reload-exported').click();
    } else if (source === 'imported') {
      const input = element('#load-json');
      input.files = [{ name: 'imported.json', text: async () => JSON.stringify(file) }];
      await input.dispatch('change');
    } else await element('#reload-original').click();

    const replacement = scene.editor!;
    const puppet = vi.mocked(Puppet).mock.results[1]!.value as Puppet;
    assert.notStrictEqual(replacement, editor);
    assert.deepEqual(element('#visibility').querySelectorAll('input'), controls);
    assert.isTrue(artwork.checked);
    assert.equal(opacity.value, '1');
    assert.equal(replacement.state.artworkOpacity, 1);
    opacity.value = '0.5';
    await opacity.dispatch('change');
    assert.equal(replacement.state.artworkOpacity, 0.5);
    assert.equal(puppet.getBone('root').sprite!.alpha, 0.5);
    assert.equal(editor.state.artworkOpacity, 0.25);
    opacity.value = '1';
    await opacity.dispatch('change');
    for (const control of controls) {
      const key = control.dataset.visibility as keyof typeof replacement.state.visibility;
      const previous = editor.state.visibility[key];
      const original = replacement.state.visibility[key];
      control.checked = !original;
      await control.dispatch('change');
      assert.equal(replacement.state.visibility[key], !original);
      assert.equal(editor.state.visibility[key], previous);
      if (key === 'artwork') assert.equal(puppet.getBone('root').sprite!.alpha, 0);
      control.checked = original;
      await control.dispatch('change');
      assert.equal(replacement.state.visibility[key], original);
      if (key === 'artwork') assert.equal(puppet.getBone('root').sprite!.alpha, 1);
    }
    assert.isFalse(replacement.state.dirty);
    assert.isFalse(replacement.state.canUndo);
  },
);

test('an inspector depth edit updates draw order and undo restores the rig and panel', async () => {
  const { editor, puppet, element } = await panelFixture();
  const bone = demoIK[0]!.rootBone;
  const before = editor.exportJson(false);
  const order = [...editor.state.rig.renderOrder];
  await editNumber(element, bone, 'depth', [-5, -8]);
  const editedOrder = new Rig(editor.state.workingCopy).renderOrder;
  assert.notDeepEqual(editedOrder, order);
  assert.deepEqual(vi.mocked(puppet).setRenderOrder.mock.lastCall![0], editedOrder);
  assert.equal(editor.state.getBone(bone).depth, -8);
  assert.equal(editor.state.historyLength, 1);
  assert.equal(element('#dirty-status').textContent, 'Unsaved changes *');
  assert.isFalse(element('#undo').disabled);

  await element('#undo').click();
  assert.equal(editor.exportJson(false), before);
  assert.deepEqual(vi.mocked(puppet).setRenderOrder.mock.lastCall![0], order);
  assert.equal(element('#dirty-status').textContent, 'No changes');
  assert.isTrue(element('#undo').disabled);
  assert.isFalse(element('#redo').disabled);
  assert.include(element('#inspector').innerHTML, 'value="0" data-scope="bone" data-field="depth"');

  await element('#redo').click();
  assert.equal(editor.state.getBone(bone).depth, -8);
  assert.deepEqual(vi.mocked(puppet).setRenderOrder.mock.lastCall![0], editedOrder);
});

test.each(['malformed JSON', 'invalid rig', 'incompatible preview', 'enable failure'])(
  'a failed import (%s) keeps the panel editable and its history usable',
  async (failure) => {
    const { scene, editor, puppet, file, disable, element } = await panelFixture();
    await editNumber(element, 'root', 'x', [5]);
    const before = editor.exportJson(false);
    const imported = structuredClone(file);
    let json: string;
    if (failure === 'malformed JSON') json = '{';
    else if (failure === 'invalid rig') json = JSON.stringify({ ...file, root: 'missing' });
    else {
      if (failure === 'incompatible preview')
        imported.bones.find((bone) => bone.id === demoIK[0]!.middleBone)!.parent = 'root';
      else
        vi.spyOn(RigEditorOverlay.prototype, 'draw').mockImplementationOnce(() => {
          throw new Error('Overlay draw failed');
        });
      json = JSON.stringify(imported);
    }
    const input = element('#load-json');
    input.value = 'failed.json';
    input.files = [{ name: 'failed.json', text: async () => json }];
    await input.dispatch('change');
    assert.include(element('#action-feedback').textContent, 'Could not load rig:');
    assert.equal(input.value, '');
    assert.strictEqual(scene.editor, editor);
    assert.equal(scene.rigFilename, 'working.json');
    assert.equal(editor.exportJson(false), before);
    assert.equal(disable.mock.calls.length, 0);
    assert.equal(vi.mocked(puppet).destroy.mock.calls.length, 0);

    await editNumber(element, 'root', 'x', [22]);
    assert.equal(editor.state.getBone('root').x, 22);
    assert.equal(puppet.getBone('root').pose.x, 22);
    assert.equal(element('#dirty-status').textContent, 'Unsaved changes *');
    await element('#undo').click();
    assert.equal(editor.exportJson(false), before);
    assert.equal(puppet.getBone('root').pose.x, 5);
    await element('#undo').click();
    assert.equal(puppet.getBone('root').pose.x, 0);
    assert.equal(element('#dirty-status').textContent, 'No changes');
  },
);

test.each(['success', 'failure'] as const)(
  'an older import %s cannot replace a newer import or its feedback',
  async (outcome) => {
    const { scene, file, element } = await panelFixture();
    let finish!: (json: string) => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<string>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const input = element('#load-json');
    input.files = [{ name: 'older.json', text: () => pending }];
    const first = input.dispatch('change');
    input.files = [{ name: 'newer.json', text: async () => JSON.stringify(file) }];
    await input.dispatch('change');
    const replacement = scene.editor;
    const feedback = element('#action-feedback').textContent;
    if (outcome === 'success') finish(JSON.stringify(file));
    else fail(new Error('Stale read failed'));
    await first;
    assert.strictEqual(scene.editor, replacement);
    assert.equal(scene.rigFilename, 'newer.json');
    assert.equal(element('#action-feedback').textContent, feedback);
  },
);

test.each(['original', 'exported', 'replacement'] as const)(
  'reloading %s invalidates a pending import',
  async (source) => {
    const { scene, file, element } = await panelFixture();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await element('#log-json').click();
    let finish!: (json: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const input = element('#load-json');
    input.files = [{ name: 'stale.json', text: () => pending }];
    const first = input.dispatch('change');
    if (source === 'replacement') scene.reloadRig(file, 'replacement.json');
    else await element(`#reload-${source}`).click();
    const replacement = scene.editor;
    const filename = scene.rigFilename;
    const feedback = element('#action-feedback').textContent;
    finish(JSON.stringify(file));
    await first;
    assert.strictEqual(scene.editor, replacement);
    assert.equal(scene.rigFilename, filename);
    assert.equal(element('#action-feedback').textContent, feedback);
  },
);
