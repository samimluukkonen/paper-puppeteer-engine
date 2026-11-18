import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import {
  getGuideById,
  GuideController,
  GuideRegistry,
  type GuideContext,
  type GuideTargetResolver,
} from '../src/devtools/shared/guides/index.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const context: GuideContext = { editor: 'rig', capabilities: ['character', 'valid-rig', 'animation'] };

test('start, ordered navigation, boundaries, finish, exit, and reset clear session state', () => {
  const controller = new GuideController(context);
  const idle = controller.getSnapshot();
  assert.equal(idle.status, 'idle');
  for (const command of [
    () => controller.next(),
    () => controller.previous(),
    () => controller.exit(),
    () => controller.finish(),
  ])
    assert.isFalse(command().ok);
  assert.strictEqual(controller.getSnapshot(), idle);
  assert.deepEqual(controller.start('rig-joint-editing'), { ok: true });
  const first = controller.getSnapshot();
  assert.equal(first.currentGuide?.id, 'rig-joint-editing');
  assert.equal(first.currentStep?.id, 'hierarchy');
  assert.equal(first.stepIndex, 0);
  assert.isFalse(controller.previous().ok);
  assert.isFalse(controller.finish().ok);
  assert.strictEqual(controller.getSnapshot(), first);
  assert.isTrue(controller.next().ok);
  assert.equal(controller.getSnapshot().currentStep?.id, 'tool');
  assert.isTrue(controller.previous().ok);
  assert.strictEqual(controller.getSnapshot().currentStep, first.currentStep);
  while (controller.getSnapshot().stepIndex! < 5) assert.isTrue(controller.next().ok);
  const last = controller.getSnapshot();
  assert.equal(last.currentStep?.id, 'history');
  assert.equal(last.stepIndex, 5);
  assert.isFalse(controller.next().ok);
  assert.strictEqual(controller.getSnapshot(), last);
  assert.isTrue(controller.finish().ok);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'finished',
    context,
    currentGuide: null,
    currentStep: null,
    stepIndex: null,
    availability: { available: true },
  });
  assert.isTrue(controller.start('rig-joint-editing').ok);
  assert.equal(controller.getSnapshot().stepIndex, 0);
  controller.exit();
  assert.equal(controller.getSnapshot().status, 'exited');
  assert.isNull(controller.getSnapshot().currentGuide);
  assert.isNull(controller.getSnapshot().currentStep);
  controller.reset();
  assert.deepEqual(controller.getSnapshot(), idle);
});

test('missing guides, wrong editors, unavailable guides, and duplicate starts preserve existing state', () => {
  const controller = new GuideController(context);
  const idle = controller.getSnapshot();
  assert.deepEqual(controller.getAvailability('unknown'), { available: false, reason: 'Guide not found: unknown' });
  assert.isFalse(controller.start('unknown').ok);
  assert.isTrue(
    controller.getAvailability('animation-timeline-navigation').available,
    'catalog availability is independent of editor navigation',
  );
  assert.deepEqual(controller.start('animation-timeline-navigation'), {
    ok: false,
    reason: 'Open the animation editor first.',
  });
  assert.strictEqual(controller.getSnapshot(), idle);
  controller.setContext({ ...context, capabilities: [] });
  const unavailable = controller.getSnapshot();
  assert.deepEqual(controller.start('rig-joint-editing'), { ok: false, reason: 'Load or create a character first.' });
  assert.strictEqual(controller.getSnapshot(), unavailable);
  controller.setContext(context);
  controller.start('rig-joint-editing');
  controller.next();
  const held = controller.getSnapshot();
  assert.isFalse(controller.start('rig-joint-editing').ok);
  assert.isFalse(controller.start('animation-timeline-navigation').ok);
  assert.strictEqual(controller.getSnapshot(), held);
});

test('context changes recheck active availability without touching progress, and exit always works', () => {
  const controller = new GuideController(context);
  controller.start('rig-joint-editing');
  const held = controller.getSnapshot();
  controller.setContext({ ...context, capabilities: [...context.capabilities] });
  assert.strictEqual(controller.getSnapshot(), held);
  controller.setContext({ ...context, capabilities: [] });
  assert.equal(controller.getSnapshot().stepIndex, 0);
  assert.deepEqual(controller.getSnapshot().availability, {
    available: false,
    reason: 'Load or create a character first.',
  });
  assert.isFalse(controller.next().ok);
  controller.setContext(context);
  assert.isTrue(controller.next().ok);
  controller.setContext({ ...context, editor: 'animation' });
  assert.deepEqual(controller.getSnapshot().availability, { available: false, reason: 'Open the rig editor first.' });
  assert.isFalse(controller.previous().ok);
  assert.isTrue(controller.exit().ok);
});

test('inactive catalog subscribers receive copied context updates and fresh availability', () => {
  const controller = new GuideController({ ...context, capabilities: [] });
  const changed = vi.fn();
  controller.subscribe(changed);
  const before = controller.getSnapshot();
  assert.isFalse(controller.getAvailability('rig-joint-editing').available);
  const capabilities = [...context.capabilities];
  controller.setContext({ ...context, capabilities });
  capabilities.length = 0;
  assert.notStrictEqual(controller.getSnapshot(), before);
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.deepEqual(controller.getSnapshot().context, context);
  assert.isTrue(controller.getAvailability('rig-joint-editing').available);
  assert.lengthOf(changed.mock.calls, 1);
  controller.setContext(context);
  assert.lengthOf(changed.mock.calls, 1, 'unchanged context preserves snapshot identity');
  controller.setContext({ ...context, capabilities: ['character', 'character', 'animation'] });
  assert.isFalse(
    controller.getAvailability('rig-joint-editing').available,
    'duplicate facts cannot mask a removed capability',
  );
});

test('individual step prerequisites gate entry and recheck after capabilities change', () => {
  const guide = getGuideById('rig-joint-editing')!;
  const registry = new GuideRegistry([
    {
      ...guide,
      steps: [
        guide.steps[0]!,
        { ...guide.steps[1]!, prerequisites: [{ capability: 'ik-constraints', reason: 'Add IK first.' }] },
      ],
    },
  ]);
  const controller = new GuideController(context, registry);
  controller.start(guide.id);
  const first = controller.getSnapshot();
  assert.deepEqual(controller.next(), { ok: false, reason: 'Add IK first.' });
  assert.strictEqual(controller.getSnapshot(), first);
  controller.setContext({ ...context, capabilities: [...context.capabilities, 'ik-constraints'] });
  assert.isTrue(controller.next().ok);
  controller.setContext(context);
  assert.isFalse(controller.finish().ok);
  assert.isTrue(controller.previous().ok, 'return to an available step even if the current prerequisite disappeared');
});

test('safe preparation is explicit, limited to reveal, and missing targets leave navigation usable', () => {
  const guide = getGuideById('rig-joint-editing')!;
  const controller = new GuideController(
    context,
    new GuideRegistry([
      {
        ...guide,
        steps: [guide.steps[0]!, { ...guide.steps[1]!, preparation: undefined }].map(({ preparation, ...step }) =>
          preparation ? { ...step, preparation } : step,
        ),
      },
    ]),
  );
  const reveal = vi.fn(() => false);
  const targets: GuideTargetResolver = { resolve: () => null, reveal };
  assert.isFalse(controller.prepareCurrentStep(targets).ok);
  controller.start('rig-joint-editing');
  assert.equal(reveal.mock.calls.length, 0, 'navigation does not run actions');
  const held = controller.getSnapshot();
  assert.deepEqual(controller.prepareCurrentStep(targets), {
    ok: false,
    reason: 'Target unavailable: rig-bone-hierarchy',
  });
  assert.strictEqual(controller.getSnapshot(), held);
  reveal.mockReturnValue(true);
  assert.isTrue(controller.prepareCurrentStep(targets).ok);
  assert.deepEqual(reveal.mock.calls[1], ['rig-bone-hierarchy']);
  controller.next();
  assert.isTrue(controller.prepareCurrentStep(targets).ok);
  assert.lengthOf(reveal.mock.calls, 2, 'steps without preparation never reveal anything');
  assert.isTrue(controller.finish().ok);
});

test('cached immutable snapshots, unsubscribe, and stable error-isolated listeners support React subscriptions', () => {
  const input = { editor: 'rig' as const, capabilities: ['character' as const, 'valid-rig' as const] };
  const controller = new GuideController(input);
  input.capabilities.length = 0;
  const notify = vi.fn();
  const release = controller.subscribe(notify);
  controller.start('rig-joint-editing');
  assert.equal(notify.mock.calls.length, 1);
  const snapshot = controller.getSnapshot();
  assert.strictEqual(controller.getSnapshot(), snapshot);
  assert.isTrue(Object.isFrozen(snapshot));
  assert.isTrue(Object.isFrozen(snapshot.availability));
  release();
  controller.next();
  assert.equal(notify.mock.calls.length, 1);
  const error = new Error('subscriber failed');
  const releaseFailure = controller.subscribe(() => {
    throw error;
  });
  const survivor = vi.fn();
  controller.subscribe(survivor);
  assert.throws(() => controller.exit(), 'subscriber failed');
  assert.equal(controller.getSnapshot().status, 'exited');
  assert.equal(survivor.mock.calls.length, 1);
  releaseFailure();
  controller.reset();
  const idle = controller.getSnapshot();
  controller.reset();
  assert.strictEqual(controller.getSnapshot(), idle);
});

test.each([false, true])(
  'guide lifecycle preserves real authored data, histories, playback, and events; dirty=%s',
  (dirty) => {
    const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
    const clip: AnimationClip = {
      name: 'move',
      duration: 1000,
      loop: true,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 500, x: 4 },
        ],
      },
      events: [{ time: 250, name: 'marker' }],
    };
    const rigState = new RigEditorState(rig);
    const animation = new AnimationEditorState(rig, [clip]);
    animation.selectAnimation('move');
    // Exercise both untouched sessions and existing unsaved authored work.
    if (dirty) {
      rigState.editBone('root', 'x', 8);
      animation.keyframes.setBonePropertyKeyframe('root', 'x', 9);
    }
    animation.playback.play();
    const rigData = rigState.workingCopy;
    const animationData = animation.workingAnimation;
    const rigJson = JSON.stringify(rigData);
    const animationJson = JSON.stringify(animationData);
    const rigHistory = rigState.historyLength;
    const animationHistory = animation.historyLength;
    const time = animation.currentTime;
    const playing = animation.playback.isPlaying;
    const event = vi.fn();
    animation.playback.onAnimationEvent(event);
    const stateChanged = vi.fn();
    animation.subscribe(stateChanged);
    const controller = new GuideController(context);
    const reveal = vi.fn(() => true);
    const targets: GuideTargetResolver = { resolve: () => null, reveal };
    for (const editor of ['rig', 'animation'] as const) {
      controller.setContext({ ...context, editor });
      const id = editor === 'rig' ? 'rig-joint-editing' : 'animation-timeline-navigation';
      controller.start(id);
      controller.prepareCurrentStep(targets);
      controller.next();
      controller.prepareCurrentStep(targets);
      controller.previous();
      while (controller.getSnapshot().stepIndex! < controller.getSnapshot().currentGuide!.steps.length - 1)
        assert.isTrue(controller.next().ok);
      assert.isTrue(controller.finish().ok);
      controller.start(id);
      controller.exit();
      controller.reset();
    }
    assert.strictEqual(rigState.workingCopy, rigData);
    assert.strictEqual(animation.workingAnimation, animationData);
    assert.equal(JSON.stringify(rigState.workingCopy), rigJson);
    assert.equal(JSON.stringify(animation.workingAnimation), animationJson);
    assert.equal(rigState.dirty, dirty);
    assert.equal(animation.dirty, dirty);
    assert.equal(rigState.historyLength, rigHistory);
    assert.equal(animation.historyLength, animationHistory);
    assert.equal(animation.currentTime, time);
    assert.equal(animation.playback.isPlaying, playing);
    assert.lengthOf(event.mock.calls, 0);
    assert.lengthOf(stateChanged.mock.calls, 0);
  },
);
