import { assert, test } from 'vitest';
import {
  cameraKeyOf,
  idOf,
  selectAction,
  selectedActionIdsOf,
  selectedActorOf,
  type SceneSelection,
} from '../src/devtools/scene-editor/SceneSelection.js';

const actorOf = (id: string) => ({ walk: 'hero', cue: 'hero', wave: 'friend' } as Record<string, string>)[id];

test('selecting actions picks the primary action’s actor and toggles additively', () => {
  let selection: SceneSelection = null;
  selection = selectAction(selection, 'walk', actorOf, false);
  assert.deepEqual(selection, { kind: 'actions', actorId: 'hero', ids: ['walk'] });
  selection = selectAction(selection, 'wave', actorOf, true);
  assert.deepEqual(selection, { kind: 'actions', actorId: 'friend', ids: ['walk', 'wave'] });
  selection = selectAction(selection, 'wave', actorOf, true);
  assert.deepEqual(selection, { kind: 'actions', actorId: 'hero', ids: ['walk'] });
  assert.deepEqual(selectAction(selection, 'walk', actorOf, true), { kind: 'actor', id: 'hero' });
  assert.deepEqual(selectAction(selection, 'cue', actorOf, false), { kind: 'actions', actorId: 'hero', ids: ['cue'] });
});

test('clearing actions steps back to their actor; other kinds clear to nothing', () => {
  assert.deepEqual(selectAction({ kind: 'actions', actorId: 'hero', ids: ['walk'] }, null, actorOf, false), {
    kind: 'actor',
    id: 'hero',
  });
  assert.deepEqual(selectAction({ kind: 'actor', id: 'hero' }, null, actorOf, false), { kind: 'actor', id: 'hero' });
  assert.isNull(selectAction({ kind: 'image', id: 'sky' }, null, actorOf, false));
  assert.isNull(selectAction({ kind: 'camera', key: null }, null, actorOf, false));
  assert.deepEqual(selectAction({ kind: 'image', id: 'sky' }, 'wave', actorOf, true), {
    kind: 'actions',
    actorId: 'friend',
    ids: ['wave'],
  });
});

test('toggling drops actions that no longer exist', () => {
  const stale: SceneSelection = { kind: 'actions', actorId: 'hero', ids: ['walk', 'deleted'] };
  assert.deepEqual(selectAction(stale, 'wave', actorOf, true), {
    kind: 'actions',
    actorId: 'friend',
    ids: ['walk', 'wave'],
  });
  assert.deepEqual(selectAction(stale, 'walk', actorOf, true), { kind: 'actor', id: 'hero' });
});

test('accessors read each variant', () => {
  const actions: SceneSelection = { kind: 'actions', actorId: 'hero', ids: ['walk', 'cue'] };
  assert.equal(selectedActorOf(actions), 'hero');
  assert.equal(selectedActorOf({ kind: 'actor', id: 'friend' }), 'friend');
  assert.isNull(selectedActorOf({ kind: 'camera', key: null }));
  assert.deepEqual(selectedActionIdsOf(actions), ['walk', 'cue']);
  assert.deepEqual(selectedActionIdsOf({ kind: 'actor', id: 'hero' }), []);
  assert.equal(idOf({ kind: 'dialogue', id: 'line' }, 'dialogue'), 'line');
  assert.isNull(idOf({ kind: 'dialogue', id: 'line' }, 'audio'));
  assert.isNull(idOf(null, 'image'));
  assert.deepEqual(cameraKeyOf({ kind: 'camera', key: { property: 'x', id: 'k' } }), { property: 'x', id: 'k' });
  assert.isNull(cameraKeyOf({ kind: 'actor', id: 'hero' }));
});
