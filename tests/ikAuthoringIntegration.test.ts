import { EventEmitter } from 'eventemitter3';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorScene } from '../src/devtools/animation-editor/AnimationEditorScene.js';
import type { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { createNewCharacter } from '../src/devtools/animation-editor/characterDocuments.js';
import { buildCharacterPackage, loadPackageDefinition } from '../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip, encodePackageZip } from '../src/devtools/shared/package/packageZip.js';
import { localToWorld } from '../src/engine/affineMath.js';
import { generateBakedBoneKeys, sampleIKBake } from '../src/engine/core.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { Puppet } from '../src/engine/Puppet.js';
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
    Math: { Vector2: class {} },
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

test('root-only character → rig IK → animation → bake → package → CharacterLoader → runtime and cleanup', async () => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { href: 'https://editor.test/' } }));
  const draft = createNewCharacter({ name: 'Tentacle', id: 'ik-integration' });
  const source = JSON.stringify(draft.definition.rigFile);
  vi.mocked(loadSceneCharacter).mockResolvedValue(draft.definition);
  const ready = vi.fn();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error);
  const fixture = puppetScene();
  const input = new EventEmitter();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input });
  scene.create();
  await vi.waitFor(() => {
    assert.deepEqual(error.mock.calls, []);
    assert.equal(ready.mock.calls.length, 1);
  });
  const editor = scene.rigEditor!;
  const animation = Reflect.get(scene, 'state') as AnimationEditorState;
  const currentPuppet = () => Reflect.get(scene, 'puppet') as Puppet;
  try {
    animation.setEditorMode('rig-tweak');
    editor.state.createBone('segment', 'root');
    editor.state.createBone('tip', 'segment');
    editor.refresh();
    editor.createIKConstraint({ name: 'tipIK', rootBone: 'root', middleBone: 'segment', endBone: 'tip' });
    editor.updateIKConstraint('tipIK', { target: { x: 20, y: 60 }, bendDirection: -1 });
    assert.isFalse(animation.hasUnsavedChanges);
    assert.equal(animation.historyLength, 0);
    assert.isTrue(editor.state.dirty);
    const exported = parseRigDefinition(JSON.parse(editor.exportJson(false)));
    scene.reloadRig(editor.exportRig(false), 'rig.json');
    assert.deepEqual(editor.state.getIKConstraint('tipIK').target, { x: 20, y: 60 });
    animation.setEditorMode('animation');
    assert.isTrue(animation.createAnimation({ name: 'reach', loop: false }));
    animation.setAuthoredPlaybackMode('smooth');
    assert.isTrue(animation.timelineTracks.some((row) => row.kind === 'ik' && row.constraintId === 'tipIK'));
    assert.isTrue(animation.selectIKConstraint('tipIK'));
    const rigHistory = editor.state.historyLength;
    for (const [time, x] of [
      [0, 20],
      [1, -20],
    ] as const) {
      animation.setCurrentTime(time);
      animation.setTemporaryIKProperty('x', x);
      animation.setTemporaryIKProperty('y', 60);
      assert.isTrue(animation.commitIKTarget());
    }
    animation.setIKPropertyKeyframe('tipIK', 'mix', 1, 0);
    assert.equal(editor.state.historyLength, rigHistory);
    const authored = animation.workingAnimation;
    assert.isTrue(animation.undo());
    assert.isTrue(animation.redo());
    assert.strictEqual(animation.workingAnimation, authored);
    animation.setCurrentTime(0.5);
    const endpoint = localToWorld({ x: 0, y: 0 }, currentPuppet().getBone('tip').container.getWorldTransformMatrix());
    const expected = localToWorld({ x: 0, y: 60 }, currentPuppet().container.getWorldTransformMatrix());
    assert.closeTo(endpoint.x, expected.x, 1e-7);
    assert.closeTo(endpoint.y, expected.y, 1e-7);

    // Inactive documents and baked suppression metadata remain live dependencies.
    animation.markSaved();
    animation.createAnimation({ name: 'rest' });
    assert.throws(() => editor.removeIKConstraint('tipIK'), /animation "reach" IK track/);
    animation.selectAnimation('reach', { keepChanges: true });
    const plan = generateBakedBoneKeys(sampleIKBake(authored!, animation.rig!, ['tipIK']), animation.rig!, {
      animation: authored!,
    });
    assert.isTrue(plan.success, JSON.stringify(plan.issues));
    if (!plan.success) throw new Error('Bake generation failed');
    assert.isTrue(animation.commitIKBake(plan));
    assert.throws(() => editor.removeIKConstraint('tipIK'), /baked IK metadata/);
    const baked = animation.workingAnimation;
    assert.isTrue(animation.undo());
    const reach = animation.workingAnimation!;
    const snapshot = scene.packageSnapshot();
    const files = decodePackageZip(
      encodePackageZip(
        await buildCharacterPackage({
          ...snapshot,
          animations: [...snapshot.animations, { ...baked!, name: 'baked' }],
        }),
      ),
    );
    const loaded = await loadPackageDefinition(files);
    assert.deepEqual(loaded.rig.ik, exported.ik);
    assert.equal(loaded.animations.length, 3);
    assert.equal(JSON.stringify(draft.definition.rigFile), source);
    assert.notMatch(new TextDecoder().decode(files.get('rig.json')), /selectedIK|gizmo|previewTarget|history/);

    const runtime = new Puppet(puppetScene(), { definition: loaded, x: 200, y: 150, autoUpdate: false });
    try {
      for (const facing of ['right', 'left'] as const) {
        runtime.setFacing(facing).play('reach');
        runtime.update(500);
        const target = localToWorld({ x: 0, y: 60 }, runtime.container.getWorldTransformMatrix());
        const end = localToWorld({ x: 0, y: 0 }, runtime.getBone('tip').container.getWorldTransformMatrix());
        assert.closeTo(end.x, target.x, 1e-7);
        assert.closeTo(end.y, target.y, 1e-7);
      }
      runtime.play('baked');
      runtime.update(500);
      assert.equal(runtime.getIK('tipIK').status, 'inactive');
      runtime.play('rest');
      runtime.update(0);
      assert.equal(runtime.getIK('tipIK').status, 'solved');
      runtime.getIK('tipIK').enabled = false;
      runtime.posePipeline.syncPose();
      assert.equal(runtime.getIK('tipIK').status, 'inactive');
    } finally {
      runtime.destroy();
    }
    assert.isTrue(animation.importJson(animation.exportJson()));
    assert.deepEqual(animation.workingAnimation!.ikTracks, reach.ikTracks);
    assert.deepEqual(error.mock.calls, []);
  } finally {
    const finalPuppet = currentPuppet();
    scene.events.emit('shutdown');
    assert.isTrue(finalPuppet.isDestroyed);
    assert.isUndefined(scene.rigEditor);
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointerupoutside', 'wheel'])
      assert.equal(input.listenerCount(event), 0);
    assert.equal(scene.events.listenerCount('update'), 0);
  }
});
