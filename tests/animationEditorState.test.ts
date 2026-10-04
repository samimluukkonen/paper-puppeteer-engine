import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';
import { demoAnimations, demoRig } from './helpers/demoCharacter.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'child', parent: 'root' }] });
const clip = (patch: Partial<AnimationClip> = {}): AnimationClip => ({
  name: 'move',
  duration: 2000,
  loop: false,
  tracks: {
    root: [
      { time: 0, x: 0 },
      { time: 1000, x: 10 },
    ],
  },
  events: [{ time: 2000, name: 'end', data: { nested: [1, 2] } }],
  ...patch,
});
const file = (animation: AnimationClip) => ({ ...animation, version: 1 });

test('sources, working copies, and nested event payloads have independent ownership', () => {
  const input = clip();
  const original = JSON.stringify(input);
  const state = new AnimationEditorState(rig, [input]);
  assert.isTrue(state.selectAnimation('move'));
  assert.notStrictEqual(state.sourceAnimation, input);
  assert.notStrictEqual(state.workingAnimation, state.sourceAnimation);
  assert.notStrictEqual(state.workingAnimation!.tracks.root, state.sourceAnimation!.tracks.root);
  assert.notStrictEqual(state.workingAnimation!.events![0]!.data, state.sourceAnimation!.events![0]!.data);
  assert.isTrue(Object.isFrozen(state.workingAnimation!.tracks.root![0]));
  assert.isTrue(Object.isFrozen(state.workingAnimation!.events![0]!.data));
  assert.deepEqual(state.workingAnimation, file(input));
  for (const time of [1.23456789, -10, 5, 0.52, NaN]) state.setCurrentTime(time);
  assert.equal(JSON.stringify(input), original);
  assert.equal(JSON.stringify(state.sourceAnimation), JSON.stringify(file(input)));
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.isFalse(Object.isFrozen(input));
});

test('selection resets continuous time, duration, working copy, playback metadata, and history', () => {
  const state = new AnimationEditorState(demoRig, demoAnimations);
  state.selectAnimation('idle');
  assert.equal(state.duration, 1.8);
  state.setCurrentTime(0.74212345);
  assert.equal(state.currentTime, 0.74212345);
  const previous = state.workingAnimation;
  assert.isTrue(state.selectAnimation('walk'));
  assert.equal(state.selectedAnimationId, 'walk');
  assert.equal(state.currentTime, 0);
  assert.equal(state.duration, demoAnimations.find((animation) => animation.name === 'walk')!.duration / 1000);
  assert.notStrictEqual(state.workingAnimation, previous);
  assert.isTrue(state.loop);
  assert.isFalse(state.isPlaying);
  assert.isFalse(state.dirty);
  state.selectAnimation('idle');
  assert.notStrictEqual(state.workingAnimation, previous);
  state.selectAnimation(null);
  assert.isNull(state.workingAnimation);
  assert.isNull(state.sourceAnimation);
  assert.equal(state.duration, 0);
  assert.equal(state.currentTime, 0);
});

test('authored replacements validate atomically, use shared history, and protect dirty selection', () => {
  const state = new AnimationEditorState(rig, [clip(), clip({ name: 'other' })]);
  state.selectAnimation('move');
  const original = state.workingAnimation;
  const replacement = file(clip({ duration: 3000 }));
  assert.isTrue(state.replaceWorkingAnimation(replacement));
  replacement.duration = 9000;
  assert.equal(state.duration, 3);
  assert.isTrue(state.dirty);
  state.setCurrentTime(2.7);
  assert.equal(state.historyLength, 1);
  assert.isFalse(state.selectAnimation('other'));
  assert.equal(state.selectedAnimationId, 'move');
  assert.isTrue(state.undo());
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.dirty);
  assert.isTrue(state.redo());
  assert.equal(state.duration, 3);
  state.markSaved();
  assert.isFalse(state.dirty);
  state.replaceWorkingAnimation(file(clip()));
  assert.isTrue(state.selectAnimation('other', { discardChanges: true }));
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
});

test.each(['other', 'renamed'])('replacement name %s cannot change selection or overwrite saved entries', (name) => {
  const state = new AnimationEditorState(rig, [clip(), clip({ name: 'other' })]);
  state.selectAnimation('move');
  state.replaceWorkingAnimation(file(clip({ duration: 3000 })));
  state.undo();
  state.setCurrentTime(0.5);
  state.play();
  const working = state.workingAnimation;
  const source = state.sourceAnimation;
  const listener = vi.fn();
  const release = state.subscribe(listener);

  assert.isFalse(state.replaceWorkingAnimation(file(clip({ name, duration: 4000 }))));
  assert.strictEqual(state.workingAnimation, working);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(state.selectedAnimationId, 'move');
  assert.deepEqual(state.animationIds, ['move', 'other']);
  assert.equal(state.currentTime, 0.5);
  assert.isTrue(state.isPlaying);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.isTrue(state.canRedo);
  assert.equal(state.validationIssues[0]?.path, 'name');
  assert.equal(listener.mock.calls.length, 1);
  release();

  state.markSaved();
  state.selectAnimation('other');
  assert.equal(state.workingAnimation!.name, 'other');
  assert.equal(state.duration, 2);
  state.selectAnimation('move');
  assert.equal(state.workingAnimation!.name, 'move');
  assert.equal(state.duration, 2);
});

test('saved edits survive switching and deselection with independent animation baselines', () => {
  const input = clip();
  const state = new AnimationEditorState(rig, [input, clip({ name: 'other' })]);
  state.selectAnimation('move');
  const source = state.sourceAnimation;
  state.replaceWorkingAnimation(file(clip({ duration: 3000 })));
  state.markSaved();
  const savedMove = state.workingAnimation;
  state.selectAnimation('other');
  state.replaceWorkingAnimation(file(clip({ name: 'other', duration: 4000 })));
  state.markSaved();
  state.selectAnimation(null);
  state.markSaved();

  state.selectAnimation('move');
  assert.equal(state.duration, 3);
  assert.deepEqual(state.workingAnimation, savedMove);
  assert.notStrictEqual(state.workingAnimation, savedMove);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(state.sourceAnimation!.duration, 2000);
  assert.equal(input.duration, 2000);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  state.selectAnimation('other');
  assert.equal(state.duration, 4);
  assert.isFalse(state.dirty);
});

test('discard restores the last saved animation and failed selection preserves unsaved edits', () => {
  const state = new AnimationEditorState(rig, [clip(), clip({ name: 'other' })]);
  state.selectAnimation('move');
  state.replaceWorkingAnimation(file(clip({ duration: 3000 })));
  state.markSaved();
  state.replaceWorkingAnimation(file(clip({ duration: 4000 })));
  assert.isFalse(state.selectAnimation('missing', { discardChanges: true }));
  assert.equal(state.duration, 4);
  assert.isTrue(state.dirty);
  assert.isFalse(state.selectAnimation('other'));
  assert.isTrue(state.selectAnimation('other', { discardChanges: true }));
  state.selectAnimation('move');
  assert.equal(state.duration, 3);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.isFalse(state.canRedo);

  state.replaceWorkingAnimation(file(clip({ duration: 5000 })));
  state.selectAnimation('move', { discardChanges: true });
  assert.equal(state.duration, 3);
  assert.isFalse(state.dirty);
});

test.each([
  { duration: 0 },
  { duration: -1 },
  { duration: Infinity },
  { tracks: { missing: [{ time: 0, x: 1 }] } },
  { events: [{ time: 2001, name: 'late' }] },
  { events: [{ time: 0, name: 'bad', data: new Map() }] },
  { events: [{ time: 0, name: 'bad', data: () => 0 }] },
])('invalid animation %j leaves the held animation intact', (patch) => {
  const state = new AnimationEditorState(rig, [clip(), clip({ ...patch, name: 'invalid' })]);
  state.selectAnimation('move');
  state.setCurrentTime(0.5);
  const before = state.workingAnimation;
  assert.isFalse(state.selectAnimation('invalid'));
  assert.isNotEmpty(state.validationIssues);
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.currentTime, 0.5);
  assert.isFalse(state.replaceWorkingAnimation(file(clip(patch))));
  assert.strictEqual(state.workingAnimation, before);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
});

test('cyclic JSON, unsupported versions, and missing animation references fail cleanly', () => {
  const state = new AnimationEditorState(rig, [clip()]);
  state.selectAnimation('move');
  const data: Record<string, unknown> = {};
  data.self = data;
  assert.isFalse(state.replaceWorkingAnimation(file(clip({ events: [{ time: 0, name: 'cycle', data }] }))));
  assert.match(state.validationIssues[0]!.message, /Cyclic/);
  assert.isFalse(state.replaceWorkingAnimation({ ...file(clip()), version: 99 }));
  assert.isFalse(state.selectAnimation('missing'));
  assert.match(state.validationIssues[0]!.message, /missing/);
  assert.equal(state.selectedAnimationId, 'move');
});

test('no character, no selection, no animations, and an empty clip are safe', () => {
  const unloaded = new AnimationEditorState();
  unloaded.setCurrentTime(1);
  assert.equal(unloaded.currentTime, 0);
  assert.isFalse(unloaded.selectAnimation('missing'));
  const empty = new AnimationEditorState(rig);
  assert.deepEqual(empty.animationIds, []);
  assert.isTrue(empty.selectAnimation(null));
  const state = new AnimationEditorState(rig, [clip({ tracks: {}, events: [] })]);
  assert.isTrue(state.selectAnimation('move'));
  assert.equal(state.duration, 2);
  state.setCurrentTime(3);
  assert.equal(state.currentTime, 2);
});

test('subscriptions reflect external state changes and unsubscribe cleanly', () => {
  const state = new AnimationEditorState(rig, [clip()]);
  let count = 0;
  const release = state.subscribe(() => {
    count += 1;
  });
  state.selectAnimation('move');
  state.setCurrentTime(1);
  state.setCurrentTime(1);
  assert.equal(count, 2);
  release();
  state.setCurrentTime(0.5);
  assert.equal(count, 2);
});

test('scrubbing and status updates reuse snapshots while authored edits and undo keep dirty state accurate', () => {
  const state = new AnimationEditorState(rig, [clip()]);
  state.selectAnimation('move');
  const release = state.subscribe(() => {
    assert.isFalse(state.dirty);
  });
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
    for (let index = 0; index < 100; index += 1) {
      state.setCurrentTime(index / 100);
      assert.isFalse(state.dirty);
    }
    assert.equal(stringify.mock.calls.length, 0);
    release();

    state.replaceWorkingAnimation(file(clip({ duration: 3000 })));
    assert.isTrue(state.dirty);
    state.markSaved();
    assert.isFalse(state.dirty);
    const serialized = stringify.mock.calls.length;
    assert.isTrue(state.undo());
    assert.isTrue(state.dirty);
    assert.isTrue(state.redo());
    assert.isFalse(state.dirty);
    assert.equal(stringify.mock.calls.length, serialized);
  } finally {
    release();
    stringify.mockRestore();
  }
});
