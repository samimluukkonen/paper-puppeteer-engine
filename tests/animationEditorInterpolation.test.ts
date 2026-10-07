import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  getAnimationInterpolation,
  getInterpolationForKeys,
  getSegmentInterpolation,
  setAnimationInterpolation,
  setInterpolationForKeys,
} from '../src/devtools/animation-editor/interpolation.js';
import { getEvaluatedBonePropertyValue } from '../src/devtools/animation-editor/keyframes.js';
import type { KeyframeSelection } from '../src/devtools/animation-editor/timelineTracks.js';
import type { AnimationClip, AnimationPlaybackMode } from '../src/engine/AnimationClip.js';
import {
  ANIMATION_FORMAT_VERSION,
  parseAnimationClip,
  validateAnimationDefinition,
} from '../src/engine/externalData.js';
import { freezeData } from '../src/engine/readonlyData.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }] });

test('dense frozen segment queries reuse indexes and preserve nearby distinct successor times', () => {
  const count = 4096;
  const input = freezeData({
    name: 'dense',
    duration: 5000,
    loop: false,
    tracks: { root: Array.from({ length: count }, (_, index) => ({ time: index * 1e-7, x: index })) },
  });
  const scan = vi.spyOn(Array.prototype, 'find');
  try {
    for (let index = 0; index < count; index++) {
      const segment = getSegmentInterpolation(input, { boneId: 'root', property: 'x', time: (index * 1e-7) / 1000 });
      if (index === count - 1) assert.isUndefined(segment);
      else assert.equal(segment!.end.time, ((index + 1) * 1e-7) / 1000);
    }
    assert.equal(scan.mock.calls.length, 0, 'successor queries must not rescan dense authored tracks');
  } finally {
    scan.mockRestore();
  }
});
const ref = (time: number, property: KeyframeSelection['property'] = 'x', boneId = 'root'): KeyframeSelection => ({
  time,
  property,
  boneId,
});
const group = [ref(0), ref(0.5), ref(0, 'y'), ref(0, 'rotation', 'arm')];
function clip(playback: AnimationPlaybackMode = { mode: 'smooth' }): AnimationClip {
  return {
    name: 'move',
    duration: 1000,
    loop: true,
    tracks: {
      root: [
        { time: 0, x: 0, y: 10 },
        { time: 250, y: 20 },
        { time: 500, x: 50 },
        { time: 1000, x: 100 },
      ],
      arm: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 1, scaleX: 2 },
      ],
    },
    events: [{ time: 500, name: 'cue', data: { nested: [1, 2] } }],
    playback,
  };
}
function session() {
  const input = clip();
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation('move');
  state.selectKeyframes(group);
  return { input, state };
}

test('implicit and explicit linear declarations query identically without freezing mutable callers', () => {
  const input = clip();
  const before = JSON.stringify(input);
  assert.equal(getAnimationInterpolation(input), 'linear');
  assert.equal(getAnimationInterpolation({ ...input, interpolation: 'linear' }), 'linear');
  assert.isUndefined(getAnimationInterpolation(null));
  assert.deepEqual(getInterpolationForKeys(input, group), { kind: 'uniform', scope: 'clip', mode: 'linear' });
  assert.equal(JSON.stringify(input), before);
  assert.isFalse(Object.isFrozen(input));
  assert.isFalse(Object.isFrozen(input.tracks.root));
});

test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
  'authored interpolation queries are independent of $mode playback sample timing',
  (playback) => {
    const input = clip(playback);
    assert.equal(getAnimationInterpolation(input), 'linear');
    assert.equal(getSegmentInterpolation(input, ref(0))!.mode, 'linear');
    assert.deepEqual(getInterpolationForKeys(input, group), { kind: 'uniform', scope: 'clip', mode: 'linear' });
  },
);

test('outgoing segments use consecutive keys of the requested property, not sparse sibling rows', () => {
  const input = clip();
  assert.deepEqual(getSegmentInterpolation(input, ref(0)), {
    scope: 'clip',
    mode: 'linear',
    start: ref(0),
    end: ref(0.5),
  });
  assert.deepEqual(getSegmentInterpolation(input, ref(0.5)), {
    scope: 'clip',
    mode: 'linear',
    start: ref(0.5),
    end: ref(1),
  });
  assert.deepEqual(getSegmentInterpolation(input, ref(0, 'y')), {
    scope: 'clip',
    mode: 'linear',
    start: ref(0, 'y'),
    end: ref(0.25, 'y'),
  });
  assert.deepEqual(getSegmentInterpolation(input, ref(0, 'rotation', 'arm')), {
    scope: 'clip',
    mode: 'linear',
    start: ref(0, 'rotation', 'arm'),
    end: ref(1, 'rotation', 'arm'),
  });
});

test('tolerant references canonicalize, but nearby distinct outgoing keys are not skipped', () => {
  const input = clip();
  assert.deepEqual(getSegmentInterpolation(input, ref(0.5000000001))!.start, ref(0.5));
  input.tracks = {
    root: [
      { time: 0, x: 1 },
      { time: 0.0000005, x: 2 },
      { time: 1000, x: 3 },
    ],
  };
  assert.equal(getSegmentInterpolation(input, ref(0))!.end.time, 0.0000005 / 1000);
});

test.each([ref(1), ref(0.25, 'y'), ref(1, 'rotation', 'arm'), ref(1, 'scaleX', 'arm')])(
  'last/single property keys have no outgoing segment even when the clip loops: %j',
  (key) => {
    const input = clip();
    assert.isUndefined(getSegmentInterpolation(input, key));
    assert.deepEqual(getInterpolationForKeys(input, [key]), { kind: 'unavailable', reason: 'no-outgoing-segment' });
    assert.strictEqual(setInterpolationForKeys(input, [key], 'linear').animation, input);
  },
);

test('selection queries reject empty, missing, nonfinite and partially unavailable references atomically', () => {
  const input = clip();
  assert.deepEqual(getInterpolationForKeys(null, group), { kind: 'unavailable', reason: 'no-animation' });
  assert.deepEqual(getInterpolationForKeys(input, []), { kind: 'unavailable', reason: 'empty-selection' });
  for (const key of [ref(0.25), ref(NaN), ref(Infinity), ref(0, 'x', 'missing'), ref(0, 'x', 'toString')]) {
    assert.isUndefined(getSegmentInterpolation(input, key));
    assert.deepEqual(getInterpolationForKeys(input, [group[0]!, key]), { kind: 'unavailable', reason: 'missing-key' });
  }
  assert.deepEqual(getInterpolationForKeys(input, [...group, ref(1)]), {
    kind: 'unavailable',
    reason: 'no-outgoing-segment',
  });
  assert.deepEqual(getInterpolationForKeys(input, [...group, ...group]), {
    kind: 'uniform',
    scope: 'clip',
    mode: 'linear',
  });
});

test('pure clip edits add/remove metadata and preserve exact times, values and all unrelated identities', () => {
  const input = clip();
  const source = JSON.stringify(input);
  const explicit = setAnimationInterpolation(input, rig, 'linear');
  assert.notStrictEqual(explicit, input);
  assert.equal(explicit.interpolation, 'linear');
  assert.strictEqual(explicit.tracks, input.tracks);
  assert.strictEqual(explicit.events, input.events);
  assert.strictEqual(explicit.playback, input.playback);
  assert.strictEqual(setAnimationInterpolation(explicit, rig, 'linear'), explicit);
  const implicit = setAnimationInterpolation(explicit, rig, undefined);
  assert.isFalse(Object.hasOwn(implicit, 'interpolation'));
  assert.deepEqual(implicit, input);
  assert.strictEqual(setAnimationInterpolation(implicit, rig, undefined), implicit);
  assert.equal(JSON.stringify(input), source);
  assert.isFalse(Object.isFrozen(input));
  assert.isFalse(Object.isFrozen(input.tracks.root));
  assert.isFalse(Object.isFrozen(input.events![0]!.data));
});

test('frozen working snapshots retain unchanged branches and accept validated metadata edits', () => {
  const input = freezeData(clip());
  const next = setAnimationInterpolation(input, rig, 'linear');
  assert.equal(next.interpolation, 'linear');
  assert.strictEqual(next.tracks, input.tracks);
  assert.strictEqual(next.events, input.events);
  assert.isUndefined(input.interpolation);
  assert.deepEqual(validateAnimationDefinition({ version: ANIMATION_FORMAT_VERSION, ...next }, rig), []);
});

test.each(['smooth', 'stepped'] as const)('%s is rejected as interpolation by both APIs and the validator', (mode) => {
  const input = clip();
  const before = JSON.stringify(input);
  assert.throws(() => {
    // @ts-expect-error Playback modes are not authored interpolation modes.
    setAnimationInterpolation(input, rig, mode);
  });
  assert.throws(() => {
    // @ts-expect-error Selection edits also enforce the existing strict interpolation type.
    setInterpolationForKeys(input, group, mode);
  });
  assert.isNotEmpty(
    validateAnimationDefinition({ version: ANIMATION_FORMAT_VERSION, ...input, interpolation: mode }, rig),
  );
  assert.equal(JSON.stringify(input), before);
});

test('per-key and multi-key edits report unavailable without broadening ownership or partially changing data', () => {
  const input = clip();
  for (const keys of [[group[0]!], group, [...group, ref(1)], [], [ref(0, 'x', 'missing')]]) {
    const before = JSON.stringify(input);
    const result = setInterpolationForKeys(input, keys, 'linear');
    assert.equal(result.kind, 'unavailable');
    assert.strictEqual(result.animation, input);
    assert.equal(JSON.stringify(input), before);
  }
  assert.equal(setInterpolationForKeys(input, group, 'linear').reason, 'clip-only');
});

test('clip declaration changes form one history transaction with exact undo/redo and source immutability', () => {
  const { input, state } = session();
  const before = JSON.stringify(input);
  const source = state.sourceAnimation;
  const baseline = state.workingAnimation!;
  const selection = state.selectedKeys;
  const primary = state.primaryKey;
  assert.isTrue(state.setAuthoredInterpolation('linear'));
  const explicit = state.workingAnimation!;
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.strictEqual(explicit.tracks, baseline.tracks);
  assert.strictEqual(state.selectedKeys, selection);
  assert.strictEqual(state.primaryKey, primary);
  assert.isTrue(state.undo());
  assert.strictEqual(state.workingAnimation, baseline);
  assert.isFalse(state.dirty);
  assert.isTrue(state.redo());
  assert.strictEqual(state.workingAnimation, explicit);
  assert.isTrue(state.dirty);
  state.markSaved();
  assert.isFalse(state.dirty);
  assert.isTrue(state.setAuthoredInterpolation(undefined));
  const implicit = state.workingAnimation;
  assert.isFalse(Object.hasOwn(implicit!, 'interpolation'));
  assert.isTrue(state.dirty);
  state.undo();
  assert.strictEqual(state.workingAnimation, explicit);
  assert.isFalse(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, implicit);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(input), before);
  assert.isUndefined(source!.interpolation);
});

test('queries, selection and unavailable edits preserve dirty/history/redo, drafts, clock and notifications', () => {
  const { state } = session();
  state.setAuthoredInterpolation('linear');
  state.undo();
  state.selectKeyframes(group);
  state.setTemporaryBoneProperty('x', 99);
  const listener = vi.fn();
  state.subscribe(listener);
  const held = state.workingAnimation;
  const time = state.currentTime;
  assert.equal(state.authoredInterpolation, 'linear');
  assert.equal(state.selectedInterpolation.kind, 'uniform');
  assert.equal(state.getSegmentInterpolation(group[0]!)!.mode, 'linear');
  assert.isFalse(state.setSelectedKeyframeInterpolation('linear'));
  assert.isTrue(state.setAuthoredInterpolation(undefined));
  assert.isTrue(state.hasTemporaryTransform);
  assert.isTrue(state.canRedo);
  assert.isFalse(state.dirty);
  assert.strictEqual(state.workingAnimation, held);
  assert.equal(state.currentTime, time);
  assert.equal(listener.mock.calls.length, 0);
  state.redo();
  const explicit = state.workingAnimation;
  state.setAuthoredInterpolation('linear');
  assert.strictEqual(state.workingAnimation, explicit);
  assert.equal(state.historyLength, 1);
});

test('state is safe without a clip and rejects unsupported modes without session mutation', () => {
  const state = new AnimationEditorState(rig);
  assert.isUndefined(state.authoredInterpolation);
  assert.isUndefined(state.getSegmentInterpolation(ref(0)));
  assert.equal(state.selectedInterpolation.kind, 'unavailable');
  assert.isFalse(state.setAuthoredInterpolation('linear'));
  assert.isFalse(state.setSelectedKeyframeInterpolation('linear'));
  const selected = session().state;
  const held = selected.workingAnimation;
  // @ts-expect-error Runtime callers also cannot install a playback mode as interpolation.
  assert.isFalse(selected.setAuthoredInterpolation('stepped'));
  // @ts-expect-error No editor-only keyframe interpolation modes may be serialized.
  assert.isFalse(selected.setSelectedKeyframeInterpolation('smooth'));
  assert.strictEqual(selected.workingAnimation, held);
  assert.equal(selected.historyLength, 0);
  assert.isFalse(selected.dirty);
});

test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
  'metadata edits serialize, validate and reuse unchanged $mode runtime evaluation',
  (playback) => {
    const input = clip(playback);
    const next = setAnimationInterpolation(input, rig, 'linear');
    const file = { version: ANIMATION_FORMAT_VERSION, ...next };
    assert.deepEqual(validateAnimationDefinition(file, rig), []);
    assert.deepEqual(parseAnimationClip(JSON.parse(JSON.stringify(file)), rig), next);
    for (const time of [0, 150, 500, 650, 1000]) {
      assert.equal(
        getEvaluatedBonePropertyValue(next, rig, 'root', 'x', time),
        getEvaluatedBonePropertyValue(input, rig, 'root', 'x', time),
      );
    }
    assert.approximately(
      getEvaluatedBonePropertyValue(next, rig, 'root', 'x', 150),
      playback.mode === 'smooth' ? 15 : 10,
      1e-12,
    );
    const state = new AnimationEditorState(rig, [input]);
    state.selectAnimation('move');
    state.setAuthoredInterpolation('linear');
    assert.deepEqual(validateAnimationDefinition(JSON.parse(state.exportJson()), rig), []);
    state.setAuthoredInterpolation(undefined);
    assert.isFalse(Object.hasOwn(parseAnimationClip(JSON.parse(state.exportJson()), rig), 'interpolation'));
  },
);

test('invalid source animations cannot be installed by metadata editing', () => {
  const input = { ...clip(), duration: 0 };
  assert.throws(() => setAnimationInterpolation(input, rig, 'linear'));
  assert.isUndefined(input.interpolation);
});

test('one-key and empty clips allow clip metadata authoring without inventing a segment', () => {
  for (const tracks of [{ root: [{ time: 0, x: 4 }] }, {}]) {
    const input: AnimationClip = { ...clip(), tracks };
    const next = setAnimationInterpolation(input, rig, 'linear');
    assert.equal(next.interpolation, 'linear');
    assert.isUndefined(getSegmentInterpolation(next, ref(0)));
    assert.strictEqual(next.tracks, input.tracks);
    assert.deepEqual(validateAnimationDefinition({ version: ANIMATION_FORMAT_VERSION, ...next }, rig), []);
  }
});

test('the strict file format rejects per-key and per-track interpolation metadata', () => {
  const input = { version: ANIMATION_FORMAT_VERSION, ...clip() };
  for (const tracks of [
    {
      root: [
        { time: 0, x: 0, interpolation: 'linear' },
        { time: 1000, x: 100 },
      ],
    },
    {
      root: {
        interpolation: 'linear',
        keys: [
          { time: 0, x: 0 },
          { time: 1000, x: 100 },
        ],
      },
    },
  ]) {
    assert.isNotEmpty(validateAnimationDefinition({ ...input, tracks }, rig));
  }
});
