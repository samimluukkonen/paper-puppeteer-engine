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
