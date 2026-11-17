import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { EnvironmentPreviewController } from '../src/devtools/animation-editor/EnvironmentPreviewController.js';
import { FootContactGroundController } from '../src/devtools/animation-editor/FootContactGroundController.js';
import { IKInspectorController } from '../src/devtools/animation-editor/IKInspectorController.js';
import { MotionPreviewController } from '../src/devtools/animation-editor/MotionPreviewController.js';
import { GroundGuideWorkspace } from '../src/devtools/shared/GroundGuideWorkspace.js';
import { Rig } from '../src/engine/Rig.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

afterEach(() => vi.unstubAllGlobals());

function animationState() {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'arm', parent: 'root' },
      { id: 'lower', parent: 'arm', y: 60 },
      { id: 'hand', parent: 'lower', y: 50 },
    ],
    ik: [{ name: 'arm', rootBone: 'arm', middleBone: 'lower', endBone: 'hand' }],
  });
  const state = new AnimationEditorState(rig, [{ name: 'reach', duration: 1000, loop: false, tracks: {} }]);
  state.selectAnimation('reach');
  return state;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, v: string) => values.set(key, v) };
}

/** Subscribe a failing listener ahead of a healthy one, as a broken UI panel would. */
function brokenThenHealthy(owner: { subscribe(listener: () => void): () => void }) {
  const failure = new Error('UI subscriber failed');
  owner.subscribe(() => {
    throw failure;
  });
  const later = vi.fn();
  owner.subscribe(later);
  return { failure, later };
}

function stubReporter() {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  return reporter;
}

test('environment preview edits succeed and reach later listeners when a UI subscriber throws', () => {
  const reporter = stubReporter();
  const controller = new EnvironmentPreviewController();
  const { failure, later } = brokenThenHealthy(controller);

  assert.doesNotThrow(() => controller.updateCamera({ zoom: 2 }));
  assert.equal(controller.getSnapshot().camera.zoom, 2);
  assert.equal(later.mock.calls.length, 1);
  assert.strictEqual(reporter.mock.calls[0]![0], failure);
  controller.dispose();
});

test('IK inspector refreshes succeed and reach later listeners when a UI subscriber throws', () => {
  const reporter = stubReporter();
  const state = animationState();
  const controller = new IKInspectorController();
  controller.bind(state);
  const { failure, later } = brokenThenHealthy(controller);

  assert.doesNotThrow(() => state.selectIKConstraint('arm'));
  assert.equal(controller.getSnapshot().constraintId, 'arm');
  assert.isAtLeast(later.mock.calls.length, 1);
  assert.strictEqual(reporter.mock.calls[0]![0], failure);
  controller.dispose();
});

test('motion preview binding succeeds and reaches later listeners when a UI subscriber throws', () => {
  const reporter = stubReporter();
  const state = animationState();
  const controller = new MotionPreviewController();
  const { failure, later } = brokenThenHealthy(controller);

  assert.doesNotThrow(() => controller.bind(state));
  assert.equal(controller.getSnapshot().clipId, 'reach');
  assert.isAtLeast(later.mock.calls.length, 1);
  assert.strictEqual(reporter.mock.calls[0]![0], failure);
  controller.dispose();
});

test('foot contact edits succeed and reach later listeners when a UI subscriber throws', () => {
  const reporter = stubReporter();
  const controller = new FootContactGroundController();
  const { failure, later } = brokenThenHealthy(controller);
  const before = controller.getSnapshot();

  assert.doesNotThrow(() => controller.setVisible(true));
  assert.isTrue(controller.visible);
  const notifications = controller.getSnapshot() - before;
  assert.isAtLeast(notifications, 1);
  assert.equal(later.mock.calls.length, notifications);
  assert.strictEqual(reporter.mock.calls[0]![0], failure);
});

test('ground guide edits succeed and reach later listeners when a UI subscriber throws', () => {
  const reporter = stubReporter();
  const workspace = new GroundGuideWorkspace('scene-world', memoryStorage);
  workspace.bind('scene');
  const { failure, later } = brokenThenHealthy(workspace);

  assert.doesNotThrow(() => workspace.update({ y: 42 }));
  assert.equal(workspace.getSnapshot().guide.y, 42);
  assert.equal(later.mock.calls.length, 1);
  assert.strictEqual(reporter.mock.calls[0]![0], failure);
});
