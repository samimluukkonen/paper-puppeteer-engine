import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { TimelineInputController } from '../src/devtools/animation-editor/TimelineInputController.js';
import { TimelineSessionController } from '../src/devtools/animation-editor/TimelineSessionController.js';
import { Rig } from '../src/engine/Rig.js';
import { stubRigEditorDom } from './helpers/rigEditorDom.js';

afterEach(() => vi.unstubAllGlobals());

function state() {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const state = new AnimationEditorState(rig, [
    { name: 'move', duration: 1000, loop: false, tracks: { root: [{ time: 0, x: 1 }] } },
  ]);
  state.selectAnimation('move');
  return state;
}

class TimelineElement extends EventTarget {
  readonly captures = new Set<number>();
  focus() {}
  closest() {
    return null;
  }
  getBoundingClientRect() {
    return { left: 0, width: 100 };
  }
  setPointerCapture(id: number) {
    this.captures.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captures.has(id);
  }
  releasePointerCapture(id: number) {
    this.captures.delete(id);
    this.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: id }));
  }
}

function inputFixture(getState: () => AnimationEditorState) {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('Element', TimelineElement);
  const app = new EventTarget() as unknown as HTMLElement;
  const timeline = new TimelineElement();
  const scrubber = new TimelineElement();
  const create = () =>
    new TimelineInputController(app, timeline as unknown as HTMLElement, getState, scrubber as unknown as HTMLElement);
  return { browser, timeline, scrubber, create };
}
const pointer = (type: string, clientX = 50, pointerId = 1) =>
  Object.assign(new Event(type, { cancelable: true }), { button: 0, pointerId, clientX });
const space = () => Object.assign(new Event('keydown', { cancelable: true }), { key: ' ', code: 'Space' });

test('scrubber keyboard navigation preserves selected authored keys and is removed on disposal', () => {
  const current = state();
  current.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  current.setCurrentTime(0.5);
  const { scrubber, create } = inputFixture(() => current);
  const input = create();
  const animation = current.workingAnimation;
  for (const [key, time] of [
    ['ArrowRight', 0.51],
    ['ArrowUp', 0.52],
    ['ArrowLeft', 0.51],
    ['ArrowDown', 0.5],
    ['Home', 0],
    ['End', 1],
  ] as const) {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
    scrubber.dispatchEvent(event);
    assert.isTrue(event.defaultPrevented);
    assert.closeTo(current.currentTime, time, 1e-9);
    assert.strictEqual(current.workingAnimation, animation);
    assert.equal(current.selectedKeyframe?.time, 0);
    assert.isFalse(current.dirty);
    assert.equal(current.historyLength, 0);
  }
  for (const guard of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
    scrubber.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Home', ...guard }));
    assert.equal(current.currentTime, 1);
  }
  input.dispose();
  scrubber.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Home' }));
  assert.equal(current.currentTime, 1);
});

test('input disposal ends scrubbing, releases capture, and permits remount without duplicate shortcuts', () => {
  const previous = state();
  let current = previous;
  const { browser, timeline, create } = inputFixture(() => current);
  const first = create();
  timeline.dispatchEvent(pointer('pointerdown'));
  assert.isTrue(previous.isScrubbing);
  assert.equal(previous.currentTime, 0.5);
  assert.isTrue(timeline.captures.has(1));
  first.dispose();
  first.dispose();
  assert.isFalse(previous.isScrubbing);
  assert.equal(timeline.captures.size, 0);
  timeline.dispatchEvent(pointer('pointerdown', 75));
  browser.dispatchEvent(space());
  assert.equal(previous.currentTime, 0.5);
  assert.isFalse(previous.isPlaying);
  current = state();
  const second = create();
  browser.dispatchEvent(space());
  assert.isTrue(current.isPlaying);
  assert.isFalse(previous.isPlaying);
  second.dispose();
});

test('input disposal cancels a key drag without committing it', () => {
  const current = state();
  const { timeline, create } = inputFixture(() => current);
  const input = create();
  input.beginKeyDrag(
    pointer('pointerdown', 0) as unknown as PointerEvent,
    { boneId: 'root', property: 'x', time: 0 },
    timeline as unknown as HTMLButtonElement,
  );
  timeline.dispatchEvent(pointer('pointermove', 75));
  assert.equal(current.keyframeDrag?.previewTime, 0.75);
  input.dispose();
  assert.isNull(current.keyframeDrag);
  assert.equal(current.currentTime, 0);
  assert.equal(current.historyLength, 0);
  assert.isFalse(current.dirty);
  assert.equal(timeline.captures.size, 0);
});

test('a key drag ignores other pointers and commits once when releasing capture triggers cancellation', () => {
  const current = state();
  const { timeline, create } = inputFixture(() => current);
  const input = create();
  const commit = vi.spyOn(current, 'commitKeyframeDrag');
  input.beginKeyDrag(
    pointer('pointerdown', 0) as unknown as PointerEvent,
    { boneId: 'root', property: 'x', time: 0 },
    timeline as unknown as HTMLButtonElement,
  );
  timeline.dispatchEvent(pointer('pointerdown', 90, 2));
  timeline.dispatchEvent(pointer('pointermove', 90, 2));
  timeline.dispatchEvent(pointer('pointercancel', 90, 2));
  timeline.dispatchEvent(pointer('pointerup', 90, 2));
  assert.equal(current.keyframeDrag?.previewTime, 0);
  assert.isFalse(current.isScrubbing);
  assert.deepEqual([...timeline.captures], [1]);
  timeline.dispatchEvent(pointer('pointermove', 75));
  timeline.dispatchEvent(pointer('pointerup', 75));
  timeline.dispatchEvent(pointer('pointerup', 75));
  assert.equal(commit.mock.calls.length, 1);
  assert.isNull(current.keyframeDrag);
  assert.equal(current.selectedKeyframe?.time, 0.75);
  assert.equal(current.historyLength, 1);
  assert.isTrue(current.dirty);
  assert.equal(timeline.captures.size, 0);
  input.dispose();
});

test('session actions follow replacements and disposed controls do not handle remounted events', async () => {
  const query = stubRigEditorDom();
  const app = query('#editor-app') as unknown as HTMLElement;
  let current = state();
  const previous = current;
  const first = new TimelineSessionController(app, () => current, { endScrub() {} });
  await query('#play-pause').click();
  assert.isTrue(previous.isPlaying);
  current = state();
  await query('#play-pause').click();
  assert.isTrue(current.isPlaying);
  current.pause();
  first.dispose();
  first.dispose();
  const second = new TimelineSessionController(app, () => current, { endScrub() {} });
  await query('#play-pause').click();
  assert.isTrue(current.isPlaying);
  assert.isTrue(previous.isPlaying);
  second.dispose();
  await query('#play-pause').click();
  assert.isTrue(current.isPlaying);
});
