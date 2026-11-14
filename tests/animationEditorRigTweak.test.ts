import { EventEmitter } from 'eventemitter3';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorScene } from '../src/devtools/animation-editor/AnimationEditorScene.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { RigTweakController } from '../src/devtools/animation-editor/RigTweakController.js';
import { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { rigDraftKey } from '../src/devtools/shared/rigDraftSession.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import type { RigJsonDefinition } from '../src/engine/externalData.js';
import type { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { loadSceneCharacter } from '../src/shared/loadSceneCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      events = new EventEmitter();
      sys = { isActive: () => true };
    },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Math: {
      Vector2: class {
        constructor(
          readonly x: number,
          readonly y: number,
        ) {}
      },
    },
  },
}));
vi.mock('../src/shared/loadSceneCharacter.js', () => ({ loadSceneCharacter: vi.fn() }));
vi.mock('../src/devtools/rig-editor/RigEditorOverlay.js', () => ({
  RigEditorOverlay: class {
    invalidate() {}
    draw() {}
    destroy() {}
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function character() {
  return CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'tweak',
      rig: 'rig.json',
      textures: { art: 'art.png' },
      skins: { basic: 'skin.json' },
      defaultSkin: 'basic',
      animations: ['motion.json'],
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [
        { id: 'root' },
        { id: 'upper', parent: 'root' },
        { id: 'lower', parent: 'upper', y: 60, sprite: { texture: 'art', x: 2 } },
        { id: 'hand', parent: 'lower', y: 50 },
      ],
      slots: [{ id: 'visual', bone: 'lower' }],
      attachments: [{ id: 'art', texture: 'art' }],
      ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' }],
    },
    skins: { 'skin.json': { version: 1, name: 'basic', slots: { visual: 'art' } } },
    animations: {
      'motion.json': {
        version: 1,
        name: 'motion',
        duration: 1000,
        loop: false,
        tracks: {
          root: [
            { time: 0, rotation: 0 },
            { time: 1000, rotation: 0.4 },
          ],
        },
        ikTracks: { arm: [{ time: 0, x: 40, y: 60 }] },
        events: [{ time: 500, name: 'context' }],
      },
    },
  });
}

async function session(definition = character()) {
  const browser = {
    location: { href: 'https://example.test/animation-editor/', pathname: '/animation-editor/' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('window', browser);
  vi.mocked(loadSceneCharacter).mockResolvedValue(definition);
  const ready = vi.fn();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error);
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => {
    assert.deepEqual(error.mock.calls, []);
    assert.equal(ready.mock.calls.length, 1);
  });
  assert.deepEqual(error.mock.calls, []);
  const state = ready.mock.calls[0]![0] as AnimationEditorState;
  const puppet = Reflect.get(scene, 'puppet') as Puppet;
  return { scene, state, puppet, editor: scene.rigEditor!, definition, browser, ready };
}

test('structural rig edits rebuild shared runtime consumers without replacing animation documents or leaking listeners', async () => {
  const { scene, state, editor, puppet } = await session();
  try {
    state.setCurrentTime(0.5);
    const animation = state.workingAnimation;
    const history = state.historyLength;
    state.setEditorMode('rig');
    const listeners = scene.input.listenerCount('pointerdown');
    const subscribers = (Reflect.get(Reflect.get(state, 'session'), 'listeners') as Set<unknown>).size;
    editor.state.createBone('branch', 'root');
    editor.refresh();
    assert.isTrue(Reflect.get(puppet.container, 'isDestroyed'));
    editor.state.createSlot('branch-art', 'branch');
    editor.refresh();
    editor.state.createAttachment({ id: 'branch-image', texture: 'art' });
    editor.state.assignAttachment('branch-art', 'branch-image');
    editor.refresh();
    const current = Reflect.get(scene, 'puppet') as Puppet;
    assert.equal(current.getSlotImage('branch-art')!.texture.key, 'art');
    state.setEditorMode('animation');
    assert.closeTo(current.getBone('root').pose.rotation, 0.2, 1e-10);
    assert.strictEqual(state.workingAnimation, animation);
    assert.equal(state.historyLength, history);
    assert.equal(state.currentTime, 0.5);
    state.selectBone('branch');
    state.setEditorMode('rig');
    for (let index = 0; index < 4; index++) {
      editor.state.createBone(`twig-${index}`, 'branch');
      editor.refresh();
      editor.undo();
      editor.redo();
      assert.strictEqual(scene.rigEditor, editor);
      assert.equal(scene.input.listenerCount('pointerdown'), listeners);
      assert.equal((Reflect.get(Reflect.get(state, 'session'), 'listeners') as Set<unknown>).size, subscribers);
    }
    editor.state.assignAttachment('branch-art', undefined);
    editor.state.removeSlot('branch-art');
    editor.refresh();
    for (let index = 0; index < 4; index++) editor.state.removeBone(`twig-${index}`);
    editor.state.removeBone('branch');
    editor.refresh();
    assert.isNull(state.selectedBoneId);
    state.setEditorMode('animation');
    assert.strictEqual(state.workingAnimation, animation);
    assert.equal(state.historyLength, history);
    assert.equal(scene.packageSnapshot().rig.bones.length, 4);
  } finally {
    scene.events.emit('shutdown');
  }
});

test.each(['matching', 'rig-only', 'absent'] as const)(
  'shared rig view merges standalone skins with %s embedded skins without changing exported ownership',
  async (kind) => {
    const rig: RigJsonDefinition = {
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
        id: 'skins',
        rig: 'rig.json',
        defaultSkin: 'default',
        skins: { default: 'skin.json' },
        textures: { part: 'part.png' },
        animations: [],
      },
      rig,
      skins: { 'skin.json': { version: 1, name: 'default', slots: { visual: 'art' } } },
    });
    const { scene, state, editor, puppet } = await session(definition);
    try {
      state.setEditorMode('rig');
      for (const reload of [() => scene.reloadRig(definition.rigFile!), () => scene.reloadOriginal()]) {
        reload();
        assert.strictEqual(scene.rigEditor, editor);
        assert.equal(puppet.getAttachment('visual'), 'art');
        assert.deepEqual(editor.state.skins, definition.rig.skins);
        assert.deepEqual(editor.exportRig(false).skins, rig.skins);
      }
      const before = editor.state.workingCopy;
      assert.throws(() => scene.reloadRig({ ...definition.rigFile!, attachments: [] }), /same hierarchy/);
      assert.strictEqual(editor.state.workingCopy, before);
    } finally {
      scene.events.emit('shutdown');
    }
  },
);

test('full rig and animation routes use one document and bounded scene listeners across repeated transitions', async () => {
  const { scene, state, puppet, editor } = await session();
  state.setCurrentTime(0.5);
  const clip = state.workingAnimation;
  const listenerCount = scene.input.listenerCount('pointerdown');
  const subscribers = (Reflect.get(Reflect.get(state, 'session'), 'listeners') as Set<unknown>).size;
  for (let index = 0; index < 12; ++index) {
    state.setEditorMode('rig');
    assert.strictEqual(scene.rigEditor, editor);
    assert.equal(puppet.getBone('root').pose.rotation, 0);
    assert.isFalse(puppet.getIK('arm').enabled, 'full rig bind-pose editing keeps animation IK disabled');
    editor.editBone('lower', 'y', 70 + index);
    state.setEditorMode('rig-tweak');
    assert.closeTo(puppet.getBone('root').pose.rotation, 0.2, 1e-12);
    state.setEditorMode('animation');
    assert.equal(puppet.getBone('lower').pose.y, 70 + index);
    assert.strictEqual(state.workingAnimation, clip);
    assert.equal(state.currentTime, 0.5);
    assert.equal(scene.input.listenerCount('pointerdown'), listenerCount);
    assert.equal((Reflect.get(Reflect.get(state, 'session'), 'listeners') as Set<unknown>).size, subscribers);
  }
  scene.events.emit('shutdown');
  assert.isUndefined(scene.rigEditor);
  assert.equal(scene.input.listenerCount('pointerdown'), 0);
  assert.equal((Reflect.get(Reflect.get(state, 'session'), 'listeners') as Set<unknown>).size, 0);
});

test('mode changes pause and cancel animation gestures/drafts without authoring or playback resumption', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const state = new AnimationEditorState(rig, [
    {
      name: 'motion',
      duration: 1000,
      loop: true,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 10 },
        ],
      },
    },
  ]);
  state.selectAnimation('motion');
  state.setCurrentTime(0.4);
  state.selectBone('root');
  state.play();
  state.beginScrub();
  state.setTemporaryBoneProperty('y', 12);
  state.setEditorMode('rig-tweak');
  const animation = state.workingAnimation;
  assert.equal(state.currentTime, 0.4);
  assert.isFalse(state.isPlaying);
  assert.isFalse(state.isScrubbing);
  assert.deepEqual(state.boneTransformDraft, {});
  state.play();
  state.togglePlayback();
  state.advancePlayback(10);
  state.endScrub();
  assert.equal(state.currentTime, 0.4);
  assert.isFalse(state.isPlaying);
  assert.isFalse(state.setBonePropertyKeyframe('root', 'rotation', 1));
  assert.isFalse(state.deleteSelectedKeyframes());
  assert.isFalse(state.createAnimationEvent());
  assert.isFalse(state.setAuthoredFPS(20));
  assert.isFalse(state.undo());
  assert.isFalse(state.beginKeyframeDrag({ boneId: 'root', property: 'x', time: 0 }));
  assert.isFalse(state.replaceWorkingAnimation({ ...animation, tracks: {} }));
  assert.strictEqual(state.workingAnimation, animation);
  assert.equal(state.historyLength, 0);
  state.setEditorMode('animation');
  assert.isFalse(state.isPlaying);
  assert.equal(state.historyLength, 0);
  state.play();
  state.advancePlayback(0.1);
  assert.closeTo(state.currentTime, 0.5, 1e-12);
});

test('entering Rig Tweak cancels active keyframe and IK target drags without creating keys', async () => {
  const { scene, state } = await session();
  try {
    const animation = state.workingAnimation;
    assert.isTrue(state.beginKeyframeDrag({ boneId: 'root', property: 'rotation', time: 0 }));
    state.previewKeyframeDrag(0.2);
    const time = state.currentTime;
    state.setEditorMode('rig-tweak');
    assert.isNull(state.keyframeDrag);
    assert.strictEqual(state.workingAnimation, animation);
    assert.equal(state.currentTime, time);
    state.setEditorMode('animation');
    assert.isTrue(state.beginIKTargetDrag('arm'));
    assert.isTrue(state.previewIKTargetDrag({ x: 70, y: 90 }));
    state.setEditorMode('rig-tweak');
    assert.isNull(state.ikTargetDrag);
    assert.deepEqual(state.ikTargetDraft, {});
    assert.strictEqual(state.workingAnimation, animation);
    assert.equal(state.historyLength, 0);
    assert.isFalse(state.dirty);
  } finally {
    scene.events.emit('shutdown');
  }
});

test('one rig working copy updates paused pose, geometry, IK and ghosts while animation history remains separate', async () => {
  const { scene, state, puppet, editor, definition, ready } = await session();
  try {
    const source = JSON.stringify(definition.rigFile);
    state.setCurrentTime(0.5);
    state.selectBone('lower');
    state.setBonePropertyKeyframe('lower', 'rotation', 0.2);
    const animation = state.workingAnimation;
    const json = state.exportJson();
    const animationHistory = state.historyLength;
    const controller = new RigTweakController();
    controller.bind(state, editor);
    state.play();
    state.setEditorMode('rig-tweak');
    const before = state.sampleGhostPose(0.5)!.get('lower')!.y;
    const constraint = puppet.getIK('arm');
    const oldLength = constraint.lengthA;
    editor.editBone('lower', 'y', 85);
    assert.equal(state.rig!.getBone('lower').y, 85);
    assert.equal(puppet.getBone('lower').pose.y, 85);
    assert.equal(constraint.lengthA, 85);
    assert.notEqual(constraint.lengthA, oldLength);
    assert.equal(constraint.status, 'solved');
    assert.equal(state.sampleGhostPose(0.5)!.get('lower')!.y, 85);
    assert.equal(before, 60);
    const slotTransform = vi.spyOn(puppet, 'setSlotTransform');
    editor.editSprite('lower', 'originX', 0.25);
    editor.editSlot('visual', 'x', 17);
    assert.equal(puppet.getBone('lower').sprite!.originX, 0.25);
    assert.equal(slotTransform.mock.calls.at(-1)![1].x, 17);
    assert.strictEqual(editor.state.source.getBone('lower'), definition.rig.getBone('lower'));
    assert.equal(JSON.stringify(definition.rigFile), source);
    assert.strictEqual(state.workingAnimation, animation);
    assert.equal(state.exportJson(), json);
    assert.equal(state.historyLength, animationHistory);
    assert.equal(editor.state.historyLength, 3);
    assert.equal(ready.mock.calls.length, 1, 'rig changes do not replace the animation session');
    assert.deepEqual(controller.getSnapshot(), {
      mode: 'rig-tweak',
      ready: true,
      rigDirty: true,
      animationDirty: true,
    });
    editor.undo();
    assert.equal(slotTransform.mock.calls.at(-1)![1].x, 0);
    assert.strictEqual(state.workingAnimation, animation);
    state.setEditorMode('animation');
    state.undo();
    assert.equal(editor.state.getBone('lower').y, 85);
    assert.isFalse(state.dirty);
    state.redo();
    assert.strictEqual(state.workingAnimation, animation);
    assert.isFalse(state.isPlaying);
    assert.equal(state.currentTime, 0.5);
    controller.dispose();
  } finally {
    scene.events.emit('shutdown');
  }
});

test('rig export/import/revert retain animation keys and support a standalone rig-editor round trip', async () => {
  const { scene, state, editor } = await session();
  try {
    state.setCurrentTime(0.5);
    state.setEditorMode('rig-tweak');
    const animation = state.workingAnimation;
    const json = state.exportJson();
    editor.editBone('upper', 'length', 80);
    assert.equal(state.rig!.getBone('lower').y, 80);
    const file = editor.exportRig();
    assert.isFalse(editor.state.dirty);
    assert.isFalse(state.dirty);
    const reloaded = new RigEditorState(new Rig(file), file);
    assert.equal(reloaded.getBone('upper').length, 80);
    scene.reloadOriginal();
    assert.equal(state.rig!.getBone('lower').y, 60);
    assert.isFalse(editor.state.dirty);
    scene.reloadRig(file);
    assert.equal(state.rig!.getBone('lower').y, 80);
    assert.isTrue(editor.state.dirty);
    editor.undo();
    assert.equal(state.rig!.getBone('lower').y, 60);
    editor.redo();
    assert.equal(state.rig!.getBone('lower').y, 80);
    scene.reloadRig(file, undefined, 'reload-export');
    assert.isFalse(editor.state.dirty);
    const working = editor.state.workingCopy;
    assert.throws(() => scene.reloadRig({ ...file, root: 'other', bones: [{ id: 'other' }] }), /same hierarchy/);
    assert.strictEqual(editor.state.workingCopy, working);
    editor.resetRig();
    assert.equal(state.rig!.getBone('lower').y, 60);
    assert.strictEqual(state.workingAnimation, animation);
    assert.equal(state.exportJson(), json);
    assert.equal(state.historyLength, 0);
    assert.equal(state.currentTime, 0.5);
  } finally {
    scene.events.emit('shutdown');
  }
});

test('mode activation and scene/controller disposal balance input, overlays and preview subscriptions', async () => {
  const { scene, state, puppet, browser } = await session();
  const controller = new RigTweakController();
  controller.bind(state, scene.rigEditor!);
  const destroy = vi.spyOn(RigEditorOverlay.prototype, 'destroy');
  for (let i = 0; i < 3; ++i) {
    state.setEditorMode('rig-tweak');
    state.setEditorMode('animation');
  }
  state.setEditorMode('rig-tweak');
  controller.dispose();
  controller.dispose();
  scene.events.emit('shutdown');
  assert.equal(destroy.mock.calls.length, 4);
  assert.sameDeepMembers(browser.addEventListener.mock.calls, browser.removeEventListener.mock.calls);
  const sync = vi.spyOn(puppet, 'syncPose');
  state.setEditorMode('animation');
  state.setCurrentTime(0.8);
  assert.equal(sync.mock.calls.length, 0);
  assert.isUndefined(scene.rigEditor);
  assert.isFalse(controller.getSnapshot().ready);
});

test('rig drafts use one source-bound namespace across editor routes and hosted base paths', () => {
  assert.equal(
    rigDraftKey('/base/animation-editor/', 'hero', 'rig.json'),
    rigDraftKey('/base/rig-editor/', 'hero', 'rig.json'),
  );
  assert.notEqual(
    rigDraftKey('/base/animation-editor/', 'hero', 'rig.json'),
    rigDraftKey('/base/rig-editor/', 'other', 'rig.json'),
  );
});

test('Rig Editor default-target drags preview and commit independently of animation keys, drafts and history', async () => {
  const { scene, state, editor } = await session();
  try {
    const animation = state.workingAnimation;
    const history = state.historyLength;
    state.setEditorMode('rig');
    editor.setIKPreview(true);
    editor.state.beginIKTargetDrag('arm');
    editor.state.moveIKTarget({ x: 30, y: 80 });
    editor.refresh();
    let puppet = Reflect.get(scene, 'puppet') as Puppet;
    const target = puppet.container.getWorldTransformMatrix().transformPoint(30, 80);
    assert.closeTo(puppet.getBone('hand').getWorldPosition().x, target.x, 1e-6);
    assert.closeTo(puppet.getBone('hand').getWorldPosition().y, target.y, 1e-6);
    editor.state.endIKTargetDrag();
    editor.refresh();
    assert.equal(editor.state.historyLength, 1);
    assert.strictEqual(state.workingAnimation, animation);
    assert.equal(state.historyLength, history);
    assert.deepEqual(state.ikTargetDraft, {});
    puppet = Reflect.get(scene, 'puppet') as Puppet;
    assert.equal(puppet.getIK('arm').targetOwnership, 'animation');
    editor.undo();
    assert.isUndefined(editor.state.getIKConstraint('arm').target);
    editor.redo();
    assert.deepEqual(editor.state.getIKConstraint('arm').target, { x: 30, y: 80 });
    state.setEditorMode('animation');
    assert.strictEqual(state.workingAnimation, animation);
    assert.equal(state.historyLength, history);
    assert.equal((Reflect.get(scene, 'puppet') as Puppet).getIK('arm').targetOwnership, 'animation');
  } finally {
    scene.events.emit('shutdown');
  }
});
