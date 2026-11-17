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
