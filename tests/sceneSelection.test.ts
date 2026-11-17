import { assert, test, vi } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { parseSceneDefinition, serializeSceneDefinition } from '../src/engine/SceneDefinition.js';
import { sceneFixture } from './helpers/scenePackageFixtures.js';

function document() {
  const doc = new SceneEditorDocument();
  const scene = parseSceneDefinition({
    ...sceneFixture(),
    dialogue: [{ id: 'line', text: 'Hello', time: 0, duration: 500 }],
    audioAssets: [
      {
        id: 'tone',
        name: 'Tone',
        path: 'audio/tone.wav',
        category: 'sfx',
        durationSeconds: 2,
      },
    ],
    audioTracks: [{ id: 'sfx-1', name: 'Effects', category: 'sfx' }],
    audioClips: [
      {
        id: 'clip',
        assetId: 'tone',
        trackId: 'sfx-1',
        time: 0,
        duration: 1000,
        sourceOffset: 0,
        volume: 1,
        loop: false,
      },
    ],
    transitions: [{ id: 'fade', type: 'fade-in', time: 0, duration: 500, color: '#000000' }],
  });
  assert.isTrue(doc.importJson(serializeSceneDefinition(scene)));
  return doc;
}

test('selecting a dialogue line, audio clip or transition publishes one selection change', () => {
  const doc = document();
  for (const select of [
    () => doc.selectDialogueLine('line'),
    () => doc.selectAudioClip('clip'),
    () => doc.selectTransition('fade'),
  ]) {
    doc.selectActor('hero');
    const listener = vi.fn();
    const unsubscribe = doc.subscribeSelection(listener);
    select();
    unsubscribe();
    assert.equal(listener.mock.calls.length, 1);
  }
});

test('toggling camera preview keeps the dialogue, audio, transition or camera-key selection', () => {
  const doc = document();
  for (const [select, selected] of [
    [() => doc.selectDialogueLine('line'), () => doc.selectedDialogueLine?.id],
    [() => doc.selectAudioClip('clip'), () => doc.selectedAudioClip?.id],
    [() => doc.selectTransition('fade'), () => doc.selectedTransition?.id],
  ] as const) {
    select();
    doc.setCameraPreview(true);
    doc.setCameraPreview(false);
    assert.isDefined(selected());
  }
  assert.isTrue(doc.setCameraKey(0, { x: 10 }));
  const key = doc.workingScene!.cameraTracks!.x![0]!;
  doc.selectCameraKey('x', key.id);
  doc.setCameraPreview(true);
  assert.equal(doc.selectedCameraKey?.key.id, key.id);
});

test('enabling camera key editing keeps the selected key; disabling clears the key and keeps the camera', () => {
  const doc = document();
  assert.isTrue(doc.setCameraKey(0, { x: 10 }));
  const key = doc.workingScene!.cameraTracks!.x![0]!;
  doc.selectCameraKey('x', key.id);
  doc.setCameraKeyEditing(true);
  assert.equal(doc.selectedCameraKey?.key.id, key.id);
  doc.setCameraKeyEditing(false);
  assert.isFalse(doc.cameraKeyEditing);
  assert.isTrue(doc.cameraSelected);
  assert.isNull(doc.selectedCameraKey);
  doc.selectDialogueLine('line');
  doc.setCameraKeyEditing(true);
  assert.isTrue(doc.cameraSelected);
  assert.isNull(doc.selectedDialogueLine);
});

test('selecting the camera deselects the actor, so deselecting the camera leaves nothing selected', () => {
  const doc = document();
  for (const select of [() => doc.selectActor('hero'), () => doc.selectAction('walk')]) {
    select();
    doc.selectCamera();
    assert.isTrue(doc.cameraSelected);
    assert.isNull(doc.selectedActorId);
    doc.selectCamera(false);
    assert.isFalse(doc.cameraSelected);
    assert.isNull(doc.selectedActorId);
    assert.isNull(doc.selectedActionId);
  }
});

test('framing an actor takes the actor explicitly and works while the camera is selected', () => {
  const doc = document();
  doc.selectCamera();
  assert.isTrue(doc.frameActor('friend'));
  assert.deepEqual(doc.cinematicCamera, { x: 100, y: 10, zoom: 1 });
  assert.isTrue(doc.cameraSelected);
  assert.isFalse(doc.frameActor('missing'));
});

test('action selection selects its actor, toggles additively and steps back to the actor', () => {
  const doc = document();
  doc.selectAction('walk');
  assert.deepEqual([doc.selectedActionIds, doc.selectedActionId, doc.selectedActorId], [['walk'], 'walk', 'hero']);
  doc.selectAction('wave', true);
  assert.deepEqual(
    [doc.selectedActionIds, doc.selectedActionId, doc.selectedActorId],
    [['walk', 'wave'], 'wave', 'friend'],
  );
  doc.selectAction('wave', true);
  assert.deepEqual([doc.selectedActionIds, doc.selectedActionId, doc.selectedActorId], [['walk'], 'walk', 'hero']);
  doc.selectAction('walk', true);
  assert.deepEqual([doc.selectedActionIds, doc.selectedActionId, doc.selectedActorId], [[], null, 'hero']);
  doc.selectAction('cue');
  doc.selectAction(null);
  assert.deepEqual([doc.selectedActionIds, doc.selectedActionId, doc.selectedActorId], [[], null, 'hero']);
  doc.selectActor(null);
  assert.isNull(doc.selectedActorId);
});

test('every selectable kind replaces the others', () => {
  const doc = document();
  const state = () => ({
    actor: doc.selectedActorId,
    actions: doc.selectedActionIds,
    camera: doc.cameraSelected,
    dialogue: doc.selectedDialogueLine?.id ?? null,
    audio: doc.selectedAudioClip?.id ?? null,
    transition: doc.selectedTransition?.id ?? null,
  });
  const none = { actor: null, actions: [], camera: false, dialogue: null, audio: null, transition: null };
  const cases = [
    [() => doc.selectActor('hero'), { ...none, actor: 'hero' }],
    [() => doc.selectAction('walk'), { ...none, actor: 'hero', actions: ['walk'] }],
    [() => doc.selectCamera(), { ...none, camera: true }],
    [() => doc.selectDialogueLine('line'), { ...none, dialogue: 'line' }],
    [() => doc.selectAudioClip('clip'), { ...none, audio: 'clip' }],
    [() => doc.selectTransition('fade'), { ...none, transition: 'fade' }],
  ] as const;
  for (const [before] of cases)
    for (const [select, expected] of cases) {
      before();
      select();
      assert.deepEqual(state(), expected);
    }
  doc.selectAction('walk');
  doc.selectImage(null);
  assert.deepEqual(state(), none);
});
