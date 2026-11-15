import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import {
  buildCharacterPackage,
  loadPackageDefinition,
  type PackageSnapshot,
} from '../src/devtools/shared/package/characterPackage.js';
import { packageDraftWarnings } from '../src/devtools/shared/package/packageDraftWarnings.js';
import { decodePackageZip, encodePackageZip } from '../src/devtools/shared/package/packageZip.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

// A character-owned transparent PNG; no shipped character or network artwork is used.
const png = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);
function workspace() {
  const draft = createNewCharacter({ name: 'Forest Guardian', id: 'forest-guardian' });
  const snapshot = (): PackageSnapshot => ({
    definition: draft.definition,
    rig: draft.rig.recoveryDraft,
    skins: draft.rig.standaloneSkins,
    animations: draft.animation.packageAnimations(),
    replacements: [
      {
        assetKey: 'leaf',
        reference: undefined,
        blob: new Blob([png]),
        format: 'image/png',
        originScaleX: 1,
        originScaleY: 1,
        newAsset: true,
      },
    ],
  });
  return { ...draft, snapshot };
}

test('new workspace → rig/artwork/default skin → first clips → ZIP → relocated CharacterLoader → Puppet playback', async () => {
  const { definition: source, rig, animation, snapshot } = workspace();
  const original = JSON.stringify(source);
  rig.createBone('body', 'root');
  rig.createBone('head', 'body');
  rig.editBoneFields('head', { x: 12, y: -24 });
  rig.createSlot('head-visual', 'head');
  rig.createAttachment({ id: 'head-art', texture: 'leaf', originX: 0.25, x: -3 });
  rig.assignAttachment('head-visual', 'head-art');
  animation.updatePreviewRig(new Rig(rig.workingCopy, rig.skins));
  assert.isTrue(animation.createAnimation({ name: 'idle' }));
  assert.deepEqual(animation.workingAnimation!.tracks, {});
  animation.setBonePropertyKeyframe('head', 'rotation', 0, 0);
  animation.setBonePropertyKeyframe('head', 'rotation', Math.PI / 2, 0.5);
  animation.setBonePropertyKeyframe('head', 'rotation', 0, 1);
  const idle = animation.workingAnimation;
  animation.undo();
  animation.redo();
  assert.deepEqual(animation.workingAnimation, idle);
  assert.isTrue(animation.createAnimation({ name: 'wave' }));
  animation.setBonePropertyKeyframe('body', 'x', 10, 0);
  assert.isTrue(animation.selectAnimation('idle', { keepChanges: true }));
  assert.isTrue(animation.canUndo);
  assert.deepEqual(packageDraftWarnings(snapshot()), []);

  const previewPuppet = new Puppet(puppetScene(), { rig: animation.rig! });
  const preview = new AnimationEditorPreview(animation, previewPuppet);
  animation.setCurrentTime(0.5);
  assert.closeTo(previewPuppet.getBone('head').pose.rotation, Math.PI / 2, 1e-10);
  animation.play();
  animation.advancePlayback(0.1);
  animation.pause();
  preview.dispose();
  preview.dispose();
  previewPuppet.destroy();

  const before = snapshot();
  const fetcher = vi.fn<typeof fetch>();
  const files = decodePackageZip(encodePackageZip(await buildCharacterPackage(before, fetcher)));
  assert.equal(fetcher.mock.calls.length, 0);
  assert.sameMembers(
    [...files.keys()],
    [
      'character.json',
      'rig.json',
      'skins/default.json',
      'animations/idle.json',
      'animations/wave.json',
      'images/leaf.png',
    ],
  );
  const base = 'https://consumer.invalid/assets/characters/forest-guardian/';
  const loaded = await CharacterLoader.load(`${base}character.json`, (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    assert.isTrue(url.startsWith(base));
    const bytes = files.get(url.slice(base.length));
    return Promise.resolve(bytes ? new Response(bytes) : new Response(null, { status: 404 }));
  });
  assert.equal(loaded.textureUrl('leaf'), `${base}images/leaf.png`);
  const puppet = new Puppet(puppetScene(), { definition: loaded, autoUpdate: false });
  puppet.play('idle');
  puppet.update(500);
  assert.closeTo(puppet.getBone('head').pose.rotation, Math.PI / 2, 1e-10);
  assert.equal(puppet.getAttachment('head-visual'), 'head-art');
  puppet.play('wave');
  puppet.update(100);
  assert.equal(puppet.getBone('body').pose.x, 10);
  puppet.destroy();
  puppet.destroy();
  assert.isTrue(puppet.posePipeline.player.isDisposed);
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(animation.packageAnimations(), before.animations);
  assert.isTrue(rig.dirty);
  assert.isTrue(animation.hasUnsavedChanges);
  assert.isTrue(animation.canUndo);
  assert.deepEqual(files.get('images/leaf.png'), png);
  for (const [path, bytes] of files)
    if (path.endsWith('.json'))
      assert.notMatch(new TextDecoder().decode(bytes), /demo-puppet|random-paperdoll-sketch|blob:|__paper_artwork_/);
});

test('minimal and partially assigned drafts remain exportable with actionable content guidance', async () => {
  const { rig, snapshot } = workspace();
  assert.lengthOf(packageDraftWarnings(snapshot()), 3);
  const empty = await loadPackageDefinition(await buildCharacterPackage({ ...snapshot(), replacements: [] }));
  assert.lengthOf(empty.rig.bones, 1);
  assert.lengthOf(empty.animations, 0);
  assert.deepEqual(empty.textures, {});
  rig.createBone('body');
  rig.createSlot('visual', 'body');
  assert.match(packageDraftWarnings(snapshot()).join('\n'), /unassigned slots: visual/);
  rig.assignAttachment('visual', null);
  assert.notMatch(packageDraftWarnings(snapshot()).join('\n'), /unassigned/);
  await buildCharacterPackage(snapshot());
});
