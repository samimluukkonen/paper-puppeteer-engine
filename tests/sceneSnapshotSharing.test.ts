import { assert, test, vi } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import type { AudioAssetDefinition } from '../src/engine/AudioAsset.js';
import { DEFAULT_MAX_JSON_BYTES } from '../src/engine/jsonInput.js';
import {
  createEmptyScene,
  validateSceneDefinition,
  type SceneCharacterAssets,
  type SceneDefinition,
} from '../src/engine/SceneDefinition.js';

function fixture(count = 2): SceneDefinition {
  return {
    ...createEmptyScene({ id: 'sharing', duration: 10000 }),
    actors: [
      { id: 'hero', character: { manifest: 'hero.json' }, position: { x: 0, y: 0 } },
      { id: 'friend', character: { manifest: 'hero.json' }, position: { x: 10, y: 0 } },
    ],
    actions: Array.from({ length: count }, (_, index) => ({
      id: `action-${index}`,
      actorId: 'hero',
      type: 'animation',
      animation: 'idle',
      time: index * 2,
      duration: 1,
      speed: 1,
      loop: false,
    })),
    cameraTracks: { x: [{ id: 'camera-x', time: 9000, value: 10 }] },
    transitions: [{ id: 'fade', time: 8000, duration: 1000, type: 'fade-out', color: '#000000' }],
    layers: [
      { id: 'background', name: 'Background', visible: true, parallax: 1 },
      { id: 'actors', name: 'Actors', visible: true, parallax: 1 },
      { id: 'art', name: 'Art', visible: true, parallax: 1 },
    ],
    images: [
      {
        id: 'sky',
        image: 'sky.png',
        layerId: 'art',
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        visible: true,
        order: 0,
      },
    ],
    audioAssets: [{ id: 'voice', name: 'Voice', path: 'voice.wav', category: 'voice' }],
    audioTracks: [{ id: 'voice', name: 'Voice', category: 'voice' }],
    audioClips: [
      {
        id: 'voice',
        assetId: 'voice',
        trackId: 'voice',
        time: 6000,
        duration: 3000,
        sourceOffset: 0,
        volume: 1,
        loop: false,
      },
    ],
    dialogue: [{ id: 'line', actorId: 'friend', voiceClipId: 'voice', text: 'Hello', time: 5000, duration: 4000 }],
  };
}

test('a 2,000-action scene shares unchanged branches through edits, saved checkpoints and history', () => {
  const animations = ['idle'];
  const includes = vi.spyOn(animations, 'includes');
  const document = new SceneEditorDocument({ getCharacterAssets: () => ({ animations, skins: [] }) });
  assert.isTrue(document.importJson(JSON.stringify(fixture(2000))));
  const source = document.workingScene!;
  includes.mockClear();
  assert.isTrue(document.updateProperties({ name: 'Renamed' }));
  const renamed = document.workingScene!;
  for (const [key, branch] of Object.entries(source)) {
    if (branch !== null && typeof branch === 'object')
      assert.strictEqual(renamed[key as keyof SceneDefinition], branch, key);
  }
  assert.equal(includes.mock.calls.length, 0, 'rename reuses action reference validation');
  assert.isTrue(document.markSaved(renamed));
  assert.isFalse(document.dirty);
  assert.isTrue(document.undo());
  assert.strictEqual(document.workingScene, source);
  assert.isTrue(document.redo());
  assert.strictEqual(document.workingScene, renamed);
  includes.mockRestore();
});

test('Actor drags own only the changed placement and reuse action validation and unchanged Actors', () => {
  const animations = ['idle'];
  const includes = vi.spyOn(animations, 'includes');
  const document = new SceneEditorDocument({ getCharacterAssets: () => ({ animations, skins: [] }) });
  document.importJson(JSON.stringify(fixture(2000)));
  const original = document.workingScene!;
  includes.mockClear();
  assert.isTrue(document.beginActorDrag('hero'));
  const position = { x: 10, y: 20 };
  assert.isTrue(document.moveActorDrag(position));
  const moved = document.workingScene!;
  position.x = 999;
  assert.equal(moved.actors[0]!.position.x, 10);
  assert.notStrictEqual(moved.actors, original.actors);
  assert.notStrictEqual(moved.actors[0], original.actors[0]);
  assert.strictEqual(moved.actors[0]!.character, original.actors[0]!.character);
  assert.strictEqual(moved.actors[1], original.actors[1]);
  assert.strictEqual(moved.actions, original.actions);
  assert.isTrue(Object.isFrozen(moved.actors[0]!.position));
  assert.equal(includes.mock.calls.length, 0, 'placement cannot change action reference validity');
  document.cancelActorDrag();
  assert.strictEqual(document.workingScene, original);
  assert.isFalse(document.canUndo);
  includes.mockRestore();
});

test('action drags share unchanged entries and nested targets while keeping one undoable operation', () => {
  const input = fixture(2000);
  input.actions.push({ id: 'face', actorId: 'friend', type: 'face', time: 500, target: { type: 'point', x: 1, y: 2 } });
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(input));
  const original = document.workingScene!;
  const action = original.actions.at(-1)!;
  document.beginActionDrag(action.id);
  assert.isTrue(document.changeActionDrag({ ...action, time: 600 }));
  assert.isTrue(document.changeActionDrag({ ...document.workingScene!.actions.at(-1)!, time: 700 }));
  const moved = document.workingScene!;
  assert.strictEqual(moved.actors, original.actors);
  for (let index = 0; index < 2000; index++) assert.strictEqual(moved.actions[index], original.actions[index]);
  assert.equal(moved.actions.at(-1)!.time, 700);
  assert.isTrue(action.type === 'face' && moved.actions.at(-1)!.type === 'face');
  const changed = moved.actions.at(-1)!;
  if (action.type === 'face' && changed.type === 'face') assert.strictEqual(changed.target, action.target);
  document.endActionDrag();
  assert.isTrue(document.undo());
  assert.strictEqual(document.workingScene, original);
  assert.isFalse(document.canUndo);
  assert.isTrue(document.redo());
  assert.strictEqual(document.workingScene, moved);
});

test.each([
  { duration: 5000 },
  { actors: [] },
  { actors: [{ ...fixture().actors[0]!, character: { manifest: 'other.json' } }] },
  { layers: fixture().layers!.slice(0, 2) },
  { audioAssets: [] },
  { audioTracks: [] },
  { audioClips: [] },
  { actions: [...fixture().actions, { ...fixture().actions[0]!, id: 'overlap' }] },
  { transitions: [...fixture().transitions!, { ...fixture().transitions![0]!, id: 'overlap' }] },
  { dialogue: [...fixture().dialogue!, { ...fixture().dialogue![0]!, id: 'overlap' }] },
  { cameraTracks: { zoom: [{ id: 'zoom', time: 0, value: 9 }] } },
])('incremental edits reject changed domain dependencies atomically: %j', (patch) => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(fixture()));
  document.updateProperties({ name: 'Already edited' });
  const before = document.workingScene!;
  const proposed = { ...before, ...patch };
  assert.isAbove(validateSceneDefinition(proposed).length, 0);
  assert.isFalse(document.replaceScene(proposed));
  assert.deepEqual(document.validationIssues, validateSceneDefinition(proposed));
  assert.strictEqual(document.workingScene, before);
  assert.isTrue(document.canUndo);
  document.undo();
  assert.strictEqual(document.workingScene, document.sourceScene);
});

test('mutable and shallow-frozen proposals cannot poison schema caches or alias snapshots', () => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(fixture()));
  const original = document.workingScene!;
  const action = Object.freeze({
    id: 'cue',
    type: 'cue' as const,
    actorId: 'hero',
    time: 0,
    name: 'Event',
    payload: { nested: [1] },
  });
  const actions = [...original.actions, action];
  assert.isTrue(document.replaceScene({ ...original, actions }));
  const captured = document.workingScene!;
  action.payload.nested.push(2);
  assert.deepEqual(captured.actions.at(-1), { ...action, payload: { nested: [1] } });
  assert.isTrue(document.replaceScene({ ...captured, actions }));
  assert.deepEqual(document.workingScene!.actions.at(-1), action);
  assert.isFalse(Object.isFrozen(action.payload));
  assert.isTrue(Object.isFrozen(document.workingScene!.actions.at(-1)));
  const invalid = {
    ...document.workingScene!,
    actions: Object.freeze([...original.actions, { ...action, payload: { value: undefined } }]),
  };
  assert.isFalse(document.replaceScene(invalid));
});

test('reused branches cannot hide accessors, sparse arrays, extra fields, cycles or wrong collection schemas', () => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(fixture()));
  const before = document.workingScene!;
  const getter = vi.fn(() => 'Renamed');
  const accessor = Object.defineProperty({ ...before }, 'name', { enumerable: true, get: getter });
  const actions = [...before.actions];
  actions.length++;
  const cyclic: Record<string, unknown> = { ...before };
  cyclic.self = cyclic;
  for (const input of [
    accessor,
    { ...before, actions },
    cyclic,
    { ...before, extra: before.actors },
    { ...before, actions: before.actors },
    { ...before, version: 1 },
  ]) {
    assert.isFalse(document.replaceScene(input));
    assert.strictEqual(document.workingScene, before);
  }
  assert.equal(getter.mock.calls.length, 0);
});

test('in-place host character, animation, image and audio catalog changes invalidate affected domains', () => {
  const animations = ['idle'];
  const assets: SceneCharacterAssets = { animations, skins: [] };
  const characters = new Map([['hero.json', assets]]);
  const images = new Set(['sky.png']);
  const audio: AudioAssetDefinition[] = [{ ...fixture().audioAssets![0]!, durationSeconds: 10 }];
  const animationIds = ['idle'];
  const document = new SceneEditorDocument({ characters, images, getAudioAssets: () => audio }, () => animationIds);
  assert.isTrue(document.importJson(JSON.stringify(fixture())));
  const before = document.workingScene!;
  const reject = (path: string) => {
    assert.isFalse(document.updateProperties({ name: 'Rejected' }));
    assert.strictEqual(document.workingScene, before);
    assert.isTrue(document.validationIssues.some((issue) => issue.path === path));
  };
  animations.length = 0;
  reject('actions[0].animation');
  animations.push('idle');
  animationIds.length = 0;
  reject('actions[0].animation');
  animationIds.push('idle');
  images.clear();
  reject('images[0].image');
  images.add('sky.png');
  audio[0]!.durationSeconds = 1;
  reject('audioClips[0].duration');
  audio[0]!.durationSeconds = 10;
  assert.isTrue(document.updateProperties({ name: 'Accepted' }));
});

test('size limits still reject small proposals whose total formatted export becomes too large', () => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(fixture(2000)));
  const before = document.workingScene!;
  const bytes = new TextEncoder().encode(`${JSON.stringify(before, null, 2)}\n`).byteLength;
  const name = 'x'.repeat(DEFAULT_MAX_JSON_BYTES - bytes + before.name.length + 1);
  assert.isBelow(name.length, DEFAULT_MAX_JSON_BYTES);
  assert.isFalse(document.updateProperties({ name }));
  assert.strictEqual(document.workingScene, before);
  assert.isFalse(document.canUndo);
  assert.match(document.validationIssues[0]!.message, /size limit/);
  assert.isTrue(document.updateProperties({ name: 'Fits' }));
  assert.strictEqual(document.workingScene!.actions, before.actions);
});
