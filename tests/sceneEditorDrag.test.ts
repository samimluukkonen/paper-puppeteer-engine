import { assert, test } from 'vitest';
import type { SceneDrag, SceneDragTarget } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import type { SceneAudioClip } from '../src/engine/sceneAudio.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';

const manifest = '../characters/hero/character.json';
const image = (id: string, order: number) => ({
  id,
  image: `../images/${id}.png`,
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  visible: true,
  order,
});
const face = (id: string, actorId: string, time: number) => ({
  id,
  type: 'face' as const,
  actorId,
  time,
  target: { type: 'direction' as const, facing: 'left' as const },
});
const clip = (id: string, time: number): SceneAudioClip => ({
  id,
  assetId: 'tone',
  trackId: 'sfx-1',
  time,
  duration: 1000,
  sourceOffset: 0,
  volume: 1,
  loop: false,
});
const source = () => ({
  ...createEmptyScene({ id: 'drags', duration: 10000 }),
  actors: [
    { id: 'hero', character: { manifest }, position: { x: 1, y: 2 } },
    { id: 'villain', character: { manifest }, position: { x: 3, y: 4 } },
  ],
  images: [image('image-1', 0), image('image-2', 1)],
  actions: [face('face-hero', 'hero', 500), face('face-villain', 'villain', 1500)],
  audioAssets: [{ id: 'tone', name: 'Tone', path: 'audio/tone.wav', category: 'sfx' as const, durationSeconds: 2 }],
  audioTracks: [{ id: 'sfx-1', name: 'Effects', category: 'sfx' as const }],
  audioClips: [clip('clip-1', 1000), clip('clip-2', 4000)],
  cameraTracks: {
    x: [
      { id: 'key-1', time: 0, value: 0 },
      { id: 'key-2', time: 2000, value: 10 },
    ],
  },
  dialogue: [{ id: 'line', text: 'Narration', time: 0, duration: 500 }],
  transitions: [{ id: 'fade', type: 'fade-in' as const, time: 0, duration: 1000, color: '#000000' }],
});
function document(): SceneEditorDocument {
  const doc = new SceneEditorDocument();
  assert.isTrue(doc.importJson(JSON.stringify(source())));
  return doc;
}

type Kind = SceneDragTarget['kind'];
/** One drag per kind; `keep` names the selection that targets the dragged item. */
const drags: Record<
  Kind,
  { start: (doc: SceneEditorDocument) => SceneDrag<unknown> | null; change: unknown; keep: string }
> = {
  actor: {
    start: (doc) => doc.beginDrag({ kind: 'actor', id: 'hero' }),
    change: { position: { x: 50, y: 60 } },
    keep: 'actor hero',
  },
  image: {
    start: (doc) => doc.beginDrag({ kind: 'image', id: 'image-1' }),
    change: { position: { x: 20, y: 30 }, scale: { x: 2, y: 2 } },
    keep: 'image image-1',
  },
  action: {
    start: (doc) => doc.beginDrag({ kind: 'action', id: 'face-hero' }),
    change: face('face-hero', 'hero', 700),
    keep: 'action face-hero',
  },
  audio: {
    start: (doc) => doc.beginDrag({ kind: 'audio', id: 'clip-1' }),
    change: clip('clip-1', 2500),
    keep: 'audio clip-1',
  },
  camera: {
    start: (doc) => {
      doc.setCameraKeyEditing(true);
      return doc.beginDrag({ kind: 'camera' });
    },
    change: { x: 30, y: 40 },
    keep: 'camera',
  },
  cameraKey: {
    start: (doc) => doc.beginDrag({ kind: 'cameraKey', property: 'x', id: 'key-1' }),
    change: 500,
    keep: 'camera key key-1',
  },
};
const kinds = Object.keys(drags) as Kind[];
function start(doc: SceneEditorDocument, kind: Kind) {
  const drag = drags[kind].start(doc);
  assert.isNotNull(drag, `${kind} drag starts`);
  return { drag, change: drags[kind].change };
}

const selections: Record<string, (doc: SceneEditorDocument) => void> = {
  'actor hero': (doc) => doc.selectActor('hero'),
  'actor villain': (doc) => doc.selectActor('villain'),
  'image image-1': (doc) => doc.selectImage('image-1'),
  'image image-2': (doc) => doc.selectImage('image-2'),
  'action face-hero': (doc) => doc.selectAction('face-hero'),
  'action face-villain': (doc) => doc.selectAction('face-villain'),
  'audio clip-1': (doc) => doc.selectAudioClip('clip-1'),
  'audio clip-2': (doc) => doc.selectAudioClip('clip-2'),
  camera: (doc) => doc.selectCamera(),
  'camera key key-1': (doc) => doc.selectCameraKey('x', 'key-1'),
  'camera key key-2': (doc) => doc.selectCameraKey('x', 'key-2'),
  dialogue: (doc) => doc.selectDialogueLine('line'),
  transition: (doc) => doc.selectTransition('fade'),
  nothing: (doc) => doc.selectActor(null),
};

test.each(kinds.flatMap((kind) => Object.keys(selections).map((selection) => [kind, selection] as const)))(
  'a %s drag survives selecting %s only when that selects the dragged item',
  (kind, selection) => {
    const doc = document();
    const { drag, change } = start(doc, kind);
    const before = doc.workingScene;
    selections[selection]!(doc);
    if (selection === drags[kind].keep) {
      assert.isTrue(doc.hasActiveGesture);
      assert.isTrue(drag.change(change));
      drag.end();
      assert.isTrue(doc.canUndo);
    } else {
      assert.isFalse(doc.hasActiveGesture);
      assert.isFalse(drag.change(change), 'a cancelled handle is inert');
      assert.strictEqual(doc.workingScene, before);
      assert.isFalse(doc.canUndo);
    }
  },
);

test.each(kinds)('a completed %s drag is one history entry and a cancelled one is none', (kind) => {
  const doc = document();
  const initial = doc.workingScene;
  let { drag, change } = start(doc, kind);
  assert.isTrue(drag.change(change));
  assert.notStrictEqual(doc.workingScene, initial);
  drag.end();
  const moved = doc.workingScene;
  assert.isFalse(doc.hasActiveGesture);
  assert.isTrue(doc.undo());
  assert.strictEqual(doc.workingScene, initial);
  assert.isFalse(doc.canUndo);
  assert.isTrue(doc.redo());
  assert.strictEqual(doc.workingScene, moved);
  assert.isTrue(doc.undo());

  ({ drag, change } = start(doc, kind));
  assert.isTrue(drag.change(change));
  drag.cancel();
  assert.strictEqual(doc.workingScene, initial);
  assert.isFalse(doc.canUndo);
  assert.isTrue(doc.canRedo, 'a cancelled drag keeps redo');
});

test.each(kinds)('a %s handle goes inert after end, cancel, cancelDrag or a replacing drag', (kind) => {
  for (const finish of ['end', 'cancel', 'cancelDrag', 'replace'] as const) {
    const doc = document();
    const { drag, change } = start(doc, kind);
    if (finish === 'end') drag.end();
    else if (finish === 'cancel') drag.cancel();
    else if (finish === 'cancelDrag') doc.cancelDrag();
    else assert.isNotNull(doc.beginDrag({ kind: 'actor', id: 'villain' }));
    const after = doc.workingScene;
    const active = doc.hasActiveGesture;
    assert.isFalse(drag.change(change), `${finish}: change is refused`);
    drag.cancel();
    drag.end();
    assert.strictEqual(doc.workingScene, after, `${finish}: the stale handle does not edit`);
    assert.equal(doc.hasActiveGesture, active, `${finish}: the stale handle leaves the current drag alone`);
  }
});

test('beginDrag refuses locked images, camera preview, keyed camera tracks without key editing and unknown ids', () => {
  const refusals: Record<string, (doc: SceneEditorDocument) => SceneDrag<never> | null> = {
    'locked image': (doc) => {
      doc.setLayerLocked('background', true);
      return doc.beginDrag({ kind: 'image', id: 'image-1' });
    },
    'camera preview': (doc) => {
      doc.setCameraKeyEditing(true);
      doc.setCameraPreview(true);
      return doc.beginDrag({ kind: 'camera' });
    },
    'keyed camera without key editing': (doc) => doc.beginDrag({ kind: 'camera' }),
    'unknown actor': (doc) => doc.beginDrag({ kind: 'actor', id: 'missing' }),
    'unknown image': (doc) => doc.beginDrag({ kind: 'image', id: 'missing' }),
    'unknown action': (doc) => doc.beginDrag({ kind: 'action', id: 'missing' }),
    'unknown audio clip': (doc) => doc.beginDrag({ kind: 'audio', id: 'missing' }),
    'unknown camera key': (doc) => doc.beginDrag({ kind: 'cameraKey', property: 'x', id: 'missing' }),
    'no scene': () => new SceneEditorDocument().beginDrag({ kind: 'actor', id: 'hero' }),
  };
  for (const [name, refuse] of Object.entries(refusals)) {
    const doc = document();
    assert.isNull(refuse(doc), name);
    assert.isFalse(doc.hasActiveGesture, name);
    assert.isFalse(doc.hasOpenOperation, name);
  }
});

test('changing camera overlays or a layer lock cancels every drag', () => {
  for (const toggle of [
    (doc: SceneEditorDocument) => doc.setCameraOverlays(true),
    (doc: SceneEditorDocument) => doc.setLayerLocked('layer-x', true),
  ])
    for (const kind of kinds) {
      const doc = document();
      const { drag, change } = start(doc, kind);
      assert.isTrue(drag.change(change));
      toggle(doc);
      assert.isFalse(doc.hasActiveGesture, kind);
      assert.isFalse(doc.canUndo, kind);
    }
});
