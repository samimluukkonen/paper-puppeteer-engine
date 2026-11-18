import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  DEFAULT_MOTION_OPTIONS,
  diagnoseMotion,
  previewMotionCleanup,
} from '../src/devtools/animation-editor/motionDiagnostics.js';
import { MotionDiagnosticsController } from '../src/devtools/animation-editor/MotionDiagnosticsController.js';
import { compileClip, type AnimationClip, type Keyframe } from '../src/engine/AnimationClip.js';
import { shortestRotationDelta } from '../src/engine/animationMath.js';
import { evaluateClip } from '../src/engine/AnimationPose.js';
import { Rig } from '../src/engine/Rig.js';
import { ikBakeEditor, waitForIKBake } from './helpers/ikBakeEditor.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'free', parent: 'root' }] });
const linear = [
  { time: 0, x: 0 },
  { time: 500, x: 5 },
  { time: 1000, x: 10 },
];
function clip(keys: readonly Keyframe[] = linear, extra: Partial<AnimationClip> = {}): AnimationClip {
  return { name: 'motion', duration: 1000, loop: false, tracks: { free: keys }, ...extra };
}
function editor(source = clip()) {
  const state = new AnimationEditorState(rig, [source, { ...source, name: 'other' }]);
  state.selectAnimation('motion');
  const controller = new MotionDiagnosticsController();
  controller.bind(state);
  return { state, controller };
}

test('smooth motion stays quiet; abrupt rotation/translation use actual time and configurable boundaries', () => {
  assert.isEmpty(diagnoseMotion(clip(), rig).findings);
  const fast = clip([
    { time: 0, x: 0, rotation: 0 },
    { time: 10, x: 200, rotation: 2 },
    { time: 1000, x: 200, rotation: 2 },
  ]);
  const report = diagnoseMotion(fast, rig);
  assert.isTrue(report.findings.some((f) => f.property === 'rotation' && f.message.includes('rapid')));
  assert.isTrue(report.findings.some((f) => f.property === 'x' && f.message.includes('large')));
  assert.isTrue(report.findings.every((f) => f.message.startsWith('Possible') && f.message.includes('intentional')));
  assert.isEmpty(report.candidates); // Fast attack is never automatically changed or flattened.
  const boundary = clip([
    { time: 0, x: 0 },
    { time: 100, x: 100 },
  ]);
  assert.isEmpty(diagnoseMotion(boundary, rig).findings);
  assert.isNotEmpty(diagnoseMotion(boundary, rig, { positionSpeed: 999 }).findings);
  assert.isEmpty(
    diagnoseMotion(fast, rig, { positionChange: 1000, positionSpeed: 1e6, rotationChange: 4, rotationSpeed: 1e6 })
      .findings,
  );
});

test('evaluated Bezier rapid motion, mode changes and stepped discontinuities are possible findings', () => {
  const source = clip([
    { time: 0, x: 0, curves: { x: { mode: 'bezier', control1: { x: 0, y: 1 }, control2: { x: 0, y: 1 } } } },
    { time: 500, x: 80, curves: { x: { mode: 'stepped' } } },
    { time: 1000, x: 90 },
  ]);
  const report = diagnoseMotion(source, rig);
  assert.isTrue(report.findings.some((f) => f.message.includes('rapid')));
  assert.isTrue(report.findings.some((f) => f.message.includes('interpolation mode change')));
  assert.isTrue(report.findings.some((f) => f.message.includes('discontinuity')));
  assert.isEmpty(report.candidates);
});

test('redundant linear property cleanup preserves endpoints, sparse siblings, events and mutable source ownership', () => {
  const source = clip(
    [
      { time: 0, x: 0 },
      { time: 500, x: 5, y: 7 },
      { time: 1000, x: 10 },
    ],
    {
      events: [{ time: 250, name: 'hit', data: { values: [1, 2] } }],
      playback: { mode: 'stepped', fps: 12 },
    },
  );
  const before = structuredClone(source);
  const report = diagnoseMotion(source, rig);
  assert.lengthOf(report.candidates, 1);
  const preview = previewMotionCleanup(source, rig, report.candidates);
  assert.deepEqual(preview.animation.tracks.free, [
    { time: 0, x: 0 },
    { time: 500, y: 7 },
    { time: 1000, x: 10 },
  ]);
  assert.strictEqual(preview.animation.events, source.events);
  assert.deepEqual(preview.animation.playback, source.playback);
  assert.equal(preview.maxDeviation['free.x'], 0);
  assert.deepEqual(source, before);
  assert.isFalse(Object.isFrozen(source));
  assert.isFalse(Object.isFrozen(source.events));
  assert.isFalse(Object.isFrozen(source.tracks.free![0]));
  const eventKey = clip(linear, { events: [{ time: 500, name: 'hit' }] });
  assert.isEmpty(diagnoseMotion(eventKey, rig).candidates);
  assert.throws(() => previewMotionCleanup(eventKey, rig, report.candidates), /protected/);
});

for (const curve of [
  { mode: 'stepped' as const },
  { mode: 'bezier' as const, control1: { x: 0.2, y: 0.8 }, control2: { x: 0.7, y: 0.9 } },
])
  test(`cleanup preserves ${curve.mode} channels even when the middle value is collinear`, () => {
    const source = clip([{ time: 0, x: 0, curves: { x: curve } }, ...linear.slice(1)]);
    assert.isEmpty(diagnoseMotion(source, rig).candidates);
    assert.throws(
      () => previewMotionCleanup(source, rig, [{ boneId: 'free', property: 'x', timeMs: 500 }]),
      /protected/,
    );
  });

test('shortest-path rotation wrap is smooth and removable, but a full turn is preserved', () => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const source = clip([
    { time: 0, rotation: radians(170) },
    { time: 500, rotation: radians(180) },
    { time: 1000, rotation: radians(-170) },
  ]);
  const report = diagnoseMotion(source, rig);
  assert.isEmpty(report.findings);
  assert.lengthOf(report.candidates, 1);
  const preview = previewMotionCleanup(source, rig, report.candidates);
  const before = compileClip(source, rig),
    after = compileClip(preview.animation, rig);
  for (let t = 0; t <= 1000; t += 5)
    assert.isBelow(
      Math.abs(
        shortestRotationDelta(
          evaluateClip(before, t).get('free')!.rotation!,
          evaluateClip(after, t).get('free')!.rotation!,
        ),
      ),
      1e-10,
    );
  assert.isEmpty(
    diagnoseMotion(
      clip([
        { time: 0, rotation: 0 },
        { time: 500, rotation: Math.PI },
        { time: 1000, rotation: 0 },
      ]),
      rig,
    ).candidates,
  );
});

test('per-property tolerances and combined batch comparison reject accumulated drift and unsafe selections', () => {
  const source = clip([
    { time: 0, x: 0, scaleX: 1 },
    { time: 500, x: 5.005, scaleX: 1.0002 },
    { time: 1000, x: 10, scaleX: 1 },
  ]);
  const report = diagnoseMotion(source, rig);
  assert.deepEqual(
    report.candidates.map((c) => c.property),
    ['x'],
  );
  assert.closeTo(previewMotionCleanup(source, rig, report.candidates).maxDeviation['free.x']!, 0.005, 1e-10);
  assert.isEmpty(diagnoseMotion(source, rig, { positionTolerance: 0.001 }).candidates);
  assert.throws(
    () => previewMotionCleanup(source, rig, [{ boneId: 'free', property: 'scaleX', timeMs: 500 }]),
    /exceeds/,
  );
  assert.throws(() => previewMotionCleanup(source, rig, [{ boneId: 'free', property: 'x', timeMs: 0 }]), /protected/);
  // Each key independently passes, but deleting both does not.
  const cumulative = clip([
    { time: 0, x: 0 },
    { time: 333, x: 0.015 },
    { time: 666, x: 0.015 },
    { time: 1000, x: 0 },
  ]);
  assert.throws(
    () =>
      previewMotionCleanup(
        cumulative,
        rig,
        [333, 666].map((timeMs) => ({ boneId: 'free', property: 'x', timeMs })),
      ),
    /exceeds/,
  );
  const cumulativeReport = diagnoseMotion(cumulative, rig);
  assert.lengthOf(cumulativeReport.candidates, 1);
  previewMotionCleanup(cumulative, rig, cumulativeReport.candidates);
});

test('IK targets, chain and ancestor transforms and baked suppression remain intact', async () => {
  const { rig: ikRig, state, controller: bake } = ikBakeEditor();
  const original = state.workingAnimation!;
  const report = diagnoseMotion(original, ikRig);
  assert.isEmpty(report.candidates);
  const fastIK = {
    ...original,
    ikTracks: {
      arm: [
        { time: 0, x: 0 },
        { time: 1, x: 200 },
      ],
    },
  };
  assert.isTrue(diagnoseMotion(fastIK, ikRig).findings.some((f) => f.kind === 'ik'));
  bake.setConstraint('arm', true);
  await waitForIKBake(bake);
  assert.isTrue(bake.commit());
  const baked = state.workingAnimation!;
  const bakedReport = diagnoseMotion(baked, ikRig);
  assert.isEmpty(bakedReport.candidates);
  const preview = previewMotionCleanup(baked, ikRig, []);
  assert.strictEqual(preview.animation.ikTracks, baked.ikTracks);
  assert.strictEqual(preview.animation.disabledIKConstraints, baked.disabledIKConstraints);
  assert.strictEqual(preview.animation.events, baked.events);
  bake.dispose();
});

test('controller manual report, preview/cancel, timeline inspection, explicit atomic Apply, Undo/Redo and export/reload', () => {
  const { state, controller } = editor(clip(linear, { events: [{ time: 250, name: 'hit', data: { a: [1] } }] }));
  const authored = state.workingAnimation!;
  const json = state.exportJson();
  const events = vi.fn();
  state.onAnimationEvent(events);
  assert.isNull(controller.getSnapshot().report);
  assert.isFalse(controller.apply());
  assert.isTrue(controller.run());
  const report = controller.getSnapshot().report;
  state.setCurrentTime(0.2);
  assert.strictEqual(controller.getSnapshot().report, report);
  assert.isTrue(controller.previewCleanup());
  controller.compare(700, false);
  assert.strictEqual(state.previewAnimation, authored);
  controller.compare(700, true);
  assert.notStrictEqual(state.previewAnimation, authored);
  assert.equal(state.previews.previewTimeMilliseconds, 700);
  assert.equal(state.currentTime, 0.2);
  assert.strictEqual(state.workingAnimation, authored);
  assert.equal(state.exportJson(), json);
  assert.isFalse(state.canUndo);
  assert.equal(events.mock.calls.length, 0);
  controller.cancel();
  assert.strictEqual(state.previewAnimation, authored);
  assert.equal(state.previews.previewTimeMilliseconds, 200);
  controller.inspect({ kind: 'bone', id: 'free', property: 'x', timeMs: 500, message: '' });
  assert.equal(state.currentTime, 0.5);
  assert.deepEqual(state.primaryKey, { boneId: 'free', property: 'x', time: 0.5 });
  assert.isTrue(controller.previewCleanup());
  assert.isTrue(controller.apply());
  const after = state.exportJson();
  assert.notEqual(after, json);
  assert.isTrue(state.undo());
  assert.equal(state.exportJson(), json);
  assert.isFalse(state.canUndo);
  assert.isTrue(state.redo());
  assert.equal(state.exportJson(), after);
  assert.isTrue(state.importJson(after, { confirmDiscard: () => true }));
  assert.equal(state.exportJson(), after);
  assert.deepEqual(state.workingAnimation!.events, authored.events);
  assert.equal(events.mock.calls.length, 0);
  controller.dispose();
});

test('preview invalidates on selection, edits, options, playback, sessions, mode and teardown without mutating source', () => {
  const { state, controller } = editor();
  const original = state.workingAnimation;
  controller.run();
  controller.previewCleanup();
  state.selectKeyframe({ boneId: 'free', property: 'x', time: 0.5 });
  assert.isNull(controller.getSnapshot().preview);
  controller.previewCleanup();
  state.play();
  assert.isNull(controller.getSnapshot().preview);
  state.pause();
  controller.previewCleanup();
  state.keyframes.setBonePropertyKeyframe('free', 'y', 5);
  assert.isNull(controller.getSnapshot().report);
  assert.isNull(controller.getSnapshot().preview);
  controller.run();
  controller.previewCleanup();
  controller.setOption('positionTolerance', 0.005);
  assert.isNull(controller.getSnapshot().report);
  controller.run();
  controller.previewCleanup();
  state.selectAnimation('other', { keepChanges: true });
  assert.isNull(controller.getSnapshot().report);
  controller.run();
  controller.previewCleanup();
  state.setEditorMode('rig-tweak');
  assert.isNull(controller.getSnapshot().preview);
  assert.isFalse(controller.run());
  state.setEditorMode('animation');
  controller.run();
  controller.previewCleanup();
  controller.unbind();
  assert.isFalse(state.previews.cleanupPreviewActive);
  assert.deepEqual(original!.tracks.free, linear);
  controller.dispose();
});

test('configuration rejects invalid values and dense cleanup is explicitly bounded', () => {
  assert.throws(() => diagnoseMotion(clip(), rig, { positionSpeed: NaN }), /finite/);
  assert.throws(() => diagnoseMotion(clip(), rig, { rotationTolerance: Math.PI }), /tolerance/);
  assert.throws(() => diagnoseMotion(clip(), rig, { speedRatio: 1 }), /ratio/);
  const report = diagnoseMotion(clip(Array.from({ length: 257 }, (_, i) => ({ time: i, x: i }))), rig);
  assert.isEmpty(report.candidates);
  assert.lengthOf(report.notes, 1);
  assert.include(report.notes[0]!, '256');
  assert.equal(DEFAULT_MOTION_OPTIONS.positionTolerance, 0.01);
});

test('sudden-speed heuristic respects both the ratio and the prior-motion floor', () => {
  const changing = clip([
    { time: 0, x: 0 },
    { time: 100, x: 50 },
    { time: 200, x: 400 },
  ]);
  assert.isTrue(diagnoseMotion(changing, rig).findings.some((f) => f.message.includes('sudden speed increase')));
  assert.isFalse(
    diagnoseMotion(changing, rig, { speedRatio: 8 }).findings.some((f) => f.message.includes('sudden speed increase')),
  );
  const fromRest = clip([
    { time: 0, x: 0 },
    { time: 100, x: 0 },
    { time: 200, x: 350 },
  ]);
  assert.isFalse(diagnoseMotion(fromRest, rig).findings.some((f) => f.message.includes('sudden speed increase')));
});

test('protected IK data coexists with cleanup on an unrelated FK branch', () => {
  const mixedRig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', y: 10 },
      { id: 'hand', parent: 'lower', y: 10 },
      { id: 'free', parent: 'root' },
    ],
    ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' }],
  });
  const source = clip(linear, {
    tracks: { free: linear, root: linear, upper: linear },
    ikTracks: {
      arm: [
        { time: 0, x: 0 },
        { time: 500, x: 5 },
        { time: 1000, x: 10 },
      ],
    },
    disabledIKConstraints: ['arm'],
  });
  const report = diagnoseMotion(source, mixedRig);
  assert.deepEqual(
    report.candidates.map((c) => c.boneId),
    ['free'],
  );
  const result = previewMotionCleanup(source, mixedRig, report.candidates).animation;
  assert.strictEqual(result.tracks.upper, source.tracks.upper);
  assert.strictEqual(result.tracks.root, source.tracks.root);
  assert.strictEqual(result.ikTracks, source.ikTracks);
  assert.strictEqual(result.disabledIKConstraints, source.disabledIKConstraints);
  const rotation = clip(
    [
      { time: 0, rotation: 0 },
      { time: 500, rotation: 0.1 },
      { time: 1000, rotation: 0.2 },
    ],
    { disabledIKConstraints: ['arm'] },
  );
  assert.isEmpty(diagnoseMotion(rotation, mixedRig).candidates);
});

test('only checked candidates are cleaned and changing checks requires a fresh preview', () => {
  const { state, controller } = editor(
    clip([
      { time: 0, x: 0, rotation: 0 },
      { time: 500, x: 5, rotation: 0.1 },
      { time: 1000, x: 10, rotation: 0.2 },
    ]),
  );
  controller.run();
  const rotationIndex = controller.getSnapshot().report!.candidates.findIndex((c) => c.property === 'rotation');
  controller.previewCleanup();
  controller.toggle(rotationIndex);
  assert.isNull(controller.getSnapshot().preview);
  assert.isFalse(controller.apply());
  controller.previewCleanup();
  assert.isTrue(controller.apply());
  assert.deepEqual(state.workingAnimation!.tracks.free![1], { time: 500, rotation: 0.1 });
  controller.dispose();
});
