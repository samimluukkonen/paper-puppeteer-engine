import { assert, test } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { buildSceneTracks, layoutSceneActions, snapSceneTime } from '../src/devtools/scene-editor/timelineActions.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
  validateSceneDefinition,
  type SceneActionDefinition,
} from '../src/engine/SceneDefinition.js';

const manifest = 'hero.json';
function scene() {
  return {
    ...createEmptyScene({ id: 'timeline' }),
    actors: ['a', 'b'].map((id) => ({ id, character: { manifest }, position: { x: 0, y: 0 } })),
  };
}
const move = (id = 'move', actorId = 'a', time = 0, duration = 1000): SceneActionDefinition => ({
  id,
  type: 'move',
  actorId,
  time,
  duration,
  destination: { x: 120, y: 0 },
});
const animation = (id = 'animation', actorId = 'a', time = 0): SceneActionDefinition => ({
  id,
  type: 'animation',
  actorId,
  time,
  duration: 1000,
  animation: 'walk',
  loop: true,
  speed: 1,
});
function document() {
  const doc = new SceneEditorDocument();
  assert.isTrue(doc.importJson(JSON.stringify(scene())));
  return doc;
}

test('every Actor has a track, including empty tracks; actions follow Actor identity and authored order', () => {
  const input = { ...scene(), actions: [move('first'), move('second', 'b')] };
  const tracks = buildSceneTracks(input);
  assert.deepEqual(
    tracks.map(({ actor, actions }) => [actor.id, actions.map(({ id }) => id)]),
    [
      ['a', ['first']],
      ['b', ['second']],
    ],
  );
  assert.deepEqual(
    buildSceneTracks(scene()).map(({ actions }) => actions),
    [[], []],
  );
});

test('add, select, move, resize, duplicate and delete retain identity and round-trip with Undo/Redo', () => {
  const doc = document();
  const source = doc.sourceScene;
  assert.isTrue(doc.addAction(move()));
  const id = doc.selectedActionId!;
  assert.equal(doc.selectedActorId, 'a');
  const first = doc.workingScene!.actions[0]!;
  assert.isTrue(doc.updateAction(id, { ...first, time: 1000, duration: 2000 } as SceneActionDefinition));
  assert.isTrue(doc.duplicateAction(id, 3000));
  const copy = doc.selectedActionId!;
  assert.notEqual(copy, id);
  assert.isTrue(doc.removeAction(id));
  assert.isTrue(doc.undo());
  assert.lengthOf(doc.workingScene!.actions, 2);
  assert.isTrue(doc.redo());
  assert.deepEqual(parseSceneJson(doc.exportJson()), doc.workingScene);
  assert.strictEqual(doc.sourceScene, source);
  assert.isEmpty(source!.actions);
  assert.deepEqual(doc.workingScene!.actors[0]!.position, { x: 0, y: 0 });
});

test('one completed drag is one undo, cancellation preserves redo, invalid edits preserve snapshots', () => {
  const doc = document();
  doc.addAction(move());
  doc.markSaved();
  const original = doc.workingScene!;
  const action = original.actions[0]!;
  doc.beginActionDrag(action.id);
  doc.changeActionDrag({ ...action, time: 1000 });
  doc.changeActionDrag({ ...action, time: 2000 });
  const valid = doc.workingScene;
  assert.isFalse(doc.changeActionDrag({ ...action, time: 10000 }));
  assert.strictEqual(doc.workingScene, valid);
  doc.endActionDrag();
  doc.undo();
  assert.strictEqual(doc.workingScene, original);
  assert.isFalse(doc.dirty);
  doc.beginActionDrag(action.id);
  doc.changeActionDrag({ ...action, time: 3000 });
  doc.cancelActionDrag();
  assert.isTrue(doc.canRedo);
  doc.redo();
  assert.equal(doc.workingScene!.actions[0]!.time, 2000);
  assert.isFalse(doc.updateAction(action.id, { ...action, id: 'changed' }));
});

test('scene switching, actor selection and undo cancel unfinished timeline gestures', () => {
  const doc = document();
  doc.addAction(move());
  const action = doc.workingScene!.actions[0]!;
  doc.beginActionDrag(action.id);
  doc.changeActionDrag({ ...action, time: 2000 });
  doc.createScene({ id: 'other' });
  doc.selectScene('timeline');
  assert.equal(doc.workingScene!.actions[0]!.time, 0);
  doc.beginActionDrag(action.id);
  doc.changeActionDrag({ ...action, time: 2000 });
  doc.selectActor('b');
  assert.equal(doc.workingScene!.actions[0]!.time, 0);
  assert.isFalse(doc.changeActionDrag(action));
});

test('bounded animation loops require explicit duration, speed and loop; natural clips use the same window', () => {
  assert.isEmpty(validateSceneDefinition({ ...scene(), actions: [animation()] }));
  for (const patch of [
    { duration: undefined },
    { duration: 0 },
    { duration: Infinity },
    { speed: 0 },
    { speed: NaN },
    { loop: undefined },
    { time: -1 },
    { duration: 10001 },
  ]) {
    assert.isNotEmpty(validateSceneDefinition({ ...scene(), actions: [{ ...animation(), ...patch }] }));
  }
  assert.isEmpty(validateSceneDefinition({ ...scene(), actions: [{ ...animation(), loop: false, speed: 2 }] }));
});

test('ownership is per Actor and channel, adjacent clips are valid, movement and base animation coexist', () => {
  for (const actions of [
    [move(), move('overlap', 'a', 500)],
    [animation(), animation('overlap', 'a', 500)],
    [
      { id: 'f1', type: 'face', actorId: 'a', time: 0, target: { type: 'direction', facing: 'left' } },
      { id: 'f2', type: 'face', actorId: 'a', time: 0, target: { type: 'point', x: 5, y: 0 } },
    ],
  ])
    assert.match(
      validateSceneDefinition({ ...scene(), actions })
        .map(({ message }) => message)
        .join(),
      /Conflicting/,
    );
  assert.isEmpty(
    validateSceneDefinition({
      ...scene(),
      actions: [move(), move('next', 'a', 1000), move('other', 'b'), animation(), animation('other-clip', 'b')],
    }),
  );
  // Nested overlap is still found when shorter clips intervene.
  assert.match(
    validateSceneDefinition({
      ...scene(),
      actions: [move('long', 'a', 0, 9000), move('short', 'a', 1000), move('late', 'a', 8000)],
    })
      .map(({ message }) => message)
      .join(),
    /late|long/,
  );
});

test('movement uses an explicit duration and destination without changing initial placement', () => {
  const input = { ...scene(), actions: [move()] };
  const parsed = parseSceneDefinition(input);
  assert.deepEqual(parsed.actors[0]!.position, { x: 0, y: 0 });
  assert.deepEqual(parsed.actions[0], move());
  for (const patch of [
    { duration: 0 },
    { duration: -1 },
    { destination: { x: NaN, y: 0 } },
    { destination: { x: 0, y: Infinity } },
    { speed: 120 },
    { actorId: 'absent' },
  ])
    assert.isNotEmpty(validateSceneDefinition({ ...input, actions: [{ ...move(), ...patch }] }));
});

test('snap reuses shared frame, playhead, clip edge and screen tolerance rules, excludes the dragged action', () => {
  const input = { ...scene(), actions: [move('self', 'a', 1000), move('other', 'b', 2345)] };
  assert.closeTo(snapSceneTime(input, 'self', 2348, 1000, 5000, true), 2345, 1e-8);
  assert.equal(snapSceneTime(input, 'self', 4990, 1000, 5000, true), 5000);
  assert.equal(snapSceneTime(input, 'self', 1020, 1000, 5000, true), 1000); // frame grid
  assert.equal(snapSceneTime(input, 'self', 1020, 1000, 5000, false), 1020);
  assert.equal(snapSceneTime(input, 'self', 9999, 1000, 5000, true, 0, 9000), 9000);
  assert.equal(snapSceneTime(input, 'self', -100, 1000, 5000, true), 0);
});

test('facing targets validate, rename and removal include references from another Actor', () => {
  const doc = document();
  doc.addAction({ type: 'face', actorId: 'a', time: 0, target: { type: 'actor', actorId: 'b' } });
  assert.isFalse(doc.removeActor('b'));
  assert.isTrue(doc.updateActor('b', { id: 'friend' }));
  assert.deepEqual((doc.workingScene!.actions[0] as Extract<SceneActionDefinition, { type: 'face' }>).target, {
    type: 'actor',
    actorId: 'friend',
  });
  assert.isTrue(doc.removeActor('friend', { removeActions: true }));
  assert.isEmpty(doc.workingScene!.actions);
  for (const actorId of ['missing', 'a'])
    assert.isNotEmpty(
      validateSceneDefinition({
        ...scene(),
        actions: [{ id: 'face', type: 'face', actorId: 'a', time: 0, target: { type: 'actor', actorId } }],
      }),
    );
});

test('cue payloads are detached JSON metadata, preserve precision and reject callbacks, invalid JSON and duplicate IDs', () => {
  const payload = { nested: { value: [1, true, null] } };
  const cue: SceneActionDefinition = {
    id: 'cue',
    type: 'cue',
    actorId: 'a',
    time: 123.456789,
    name: 'entrance',
    payload,
  };
  const input = { ...scene(), actions: [cue] };
  const parsed = parseSceneDefinition(input);
  payload.nested.value[0] = 9;
  assert.notDeepEqual(parsed.actions[0], cue);
  assert.deepEqual(parseSceneJson(serializeSceneDefinition(parsed)), parsed);
  assert.isNotEmpty(validateSceneDefinition({ ...input, actions: [cue, cue] }));
  for (const value of [() => {}, new Date(), { bad: Infinity }, { bad: undefined }])
    assert.isNotEmpty(validateSceneDefinition({ ...input, actions: [{ ...cue, payload: value }] }));
});

test('animation references are validated against the owning character during edits and exports', () => {
  const doc = new SceneEditorDocument({}, () => ['idle']);
  doc.importJson(JSON.stringify(scene()));
  assert.isFalse(doc.addAction(animation()));
  assert.isTrue(doc.addAction({ ...animation(), animation: 'idle' } as SceneActionDefinition));
  const before = doc.workingScene;
  assert.isFalse(doc.updateProperties({ duration: 500 }));
  assert.strictEqual(doc.workingScene, before);
});

test('concurrent metadata gets separate selectable lanes without changing authored action order', () => {
  const actions: SceneActionDefinition[] = [
    { id: 'wait', type: 'wait', actorId: 'a', time: 0, duration: 1000 },
    { id: 'cue', type: 'cue', actorId: 'a', time: 100, name: 'cue' },
    { id: 'face', type: 'face', actorId: 'a', time: 100, target: { type: 'direction', facing: 'left' } },
  ];
  assert.deepEqual(
    layoutSceneActions(actions, 10000, 1000).map(({ lane }) => lane),
    [2, 3, 4],
  );
  assert.deepEqual(
    actions.map(({ id }) => id),
    ['wait', 'cue', 'face'],
  );
});
