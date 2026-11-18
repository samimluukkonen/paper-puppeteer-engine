import { setMaxListeners } from 'node:events';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { viewportXToTime } from '../src/devtools/animation-editor/timelineNavigation.js';
import { TimelineNavigationController } from '../src/devtools/animation-editor/TimelineNavigationController.js';
import { Rig } from '../src/engine/Rig.js';

class NavigationElement extends EventTarget {
  value = '';
  checked = true;
  disabled = false;
  hidden = false;
  textContent = '';
  max = '';
  clientWidth = 750;
  scrollLeft = 0;
  style = { gridTemplateColumns: '' };
  width = 250;
  get valueAsNumber() {
    return this.value === '' ? NaN : Number(this.value);
  }
  getBoundingClientRect() {
    return { left: 0, width: this.width };
  }
  private readonly attributes = new Map<string, string>();
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  // Native browser AbortSignals permit many listeners.
  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (typeof options === 'object' && options.signal) setMaxListeners(0, options.signal);
    super.addEventListener(type, callback, options);
  }
}
function fixture(duration = 10000) {
  let state = new AnimationEditorState(new Rig({ root: 'root', bones: [{ id: 'root' }] }), [
    {
      name: 'move',
      duration,
      loop: false,
      playback: { mode: 'stepped', fps: 12 },
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: duration * 0.4, x: 4 },
          { time: duration * 0.5, x: 5 },
          { time: duration, x: 10 },
        ],
      },
      events: [{ time: duration * 0.75, name: 'event' }],
    },
  ]);
  state.selectAnimation('move');
  const elements = new Map<string, NavigationElement>();
  const query = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, new NavigationElement());
    return elements.get(selector)!;
  };
  vi.stubGlobal('document', { activeElement: null });
  const changed = vi.fn();
  const cancel = vi.fn();
  const controller = new TimelineNavigationController(
    { querySelector: query } as unknown as HTMLElement,
    () => state,
    changed,
    cancel,
  );
  controller.render();
  return {
    state,
    controller,
    query,
    changed,
    cancel,
    replace(this: void, next: AnimationEditorState) {
      state = next;
    },
  };
}
const dispatch = (element: NavigationElement, type: string, properties = {}) => {
  const event = Object.assign(new Event(type, { cancelable: true }), properties);
  element.dispatchEvent(event);
  return event;
};
afterEach(() => vi.unstubAllGlobals());

test('all view commands and time/frame inputs preserve source, working snapshot, selection, history and exports', () => {
  const { state, controller, query } = fixture();
  state.selectKeyframes([
    { boneId: 'root', property: 'x', time: 4 },
    { boneId: 'root', property: 'x', time: 5 },
  ]);
  state.setTimelineFilters({ search: 'no matches' });
  const source = state.sourceAnimation;
  const working = state.workingAnimation;
  const selection = state.selectedKeys;
  const json = state.exportJson();
  controller.render();
  controller.fitSelection();
  assert.equal(controller.view.contentWidth, 4000);
  assert.closeTo(viewportXToTime(250, controller.view), 4.5, 1e-12);
  controller.zoomBy(2);
  controller.centerPlayhead();
  controller.fitAnimation();
  for (const [id, value, expected] of [
    ['#timeline-time-input', '4.123456789', 4.123456789],
    ['#timeline-frame-input', '59', 59 / 12],
    ['#timeline-time-input', '100', 10],
    ['#timeline-time-input', '-1', 0],
  ] as const) {
    query(id).value = value;
    dispatch(query(id), 'change');
    assert.closeTo(state.currentTime, expected, 1e-12);
  }
  state.setCurrentTime(2.25);
  for (const value of ['', 'invalid']) {
    query('#timeline-time-input').value = value;
    dispatch(query('#timeline-time-input'), 'change');
    assert.equal(state.currentTime, 2.25);
  }
  query('#timeline-frame-input').value = '2.5';
  dispatch(query('#timeline-frame-input'), 'change');
  assert.equal(state.currentTime, 2.25);
  assert.strictEqual(state.sourceAnimation, source);
  assert.strictEqual(state.workingAnimation, working);
  assert.strictEqual(state.selectedKeys, selection);
  assert.equal(state.exportJson(), json);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  controller.dispose();
});

test('pointer wheel zoom anchors fractional CSS coordinates, shift wheel pans, native horizontal wheel stays native', () => {
  const { controller, query } = fixture();
  const inset = query('.timeline-inset');
  controller.zoomBy(4);
  inset.scrollLeft = 400;
  const before = viewportXToTime(137.5, controller.view);
  const zoom = dispatch(inset, 'wheel', { ctrlKey: true, clientX: 387.5, deltaY: -75, deltaMode: 0 });
  assert.isTrue(zoom.defaultPrevented);
  assert.closeTo(viewportXToTime(137.5, controller.view), before, 1e-12);
  const scroll = inset.scrollLeft;
  assert.isTrue(dispatch(inset, 'wheel', { shiftKey: true, deltaY: 3, deltaX: 0, deltaMode: 1 }).defaultPrevented);
  assert.equal(inset.scrollLeft, scroll + 48);
  assert.isFalse(dispatch(inset, 'wheel', { deltaY: 0, deltaX: 50 }).defaultPrevented);
  controller.dispose();
  const disposed = dispatch(inset, 'wheel', { ctrlKey: true, deltaY: -100, clientX: 400 });
  assert.isFalse(disposed.defaultPrevented);
});

test('resize retains center time and zoom; playback follows only when enabled and never on a paused scrub', () => {
  const { state, controller, query } = fixture();
  state.setCurrentTime(5);
  controller.zoomBy(4);
  controller.centerPlayhead();
  const center = viewportXToTime(250, controller.view);
  query('.timeline-inset').clientWidth = 950;
  controller.resize();
  assert.equal(controller.view.contentWidth, 2800);
  assert.closeTo(viewportXToTime(350, controller.view), center, 1e-12);
  const scroll = query('.timeline-inset').scrollLeft;
  state.setCurrentTime(9);
  controller.render();
  assert.equal(query('.timeline-inset').scrollLeft, scroll);
  state.play();
  query('#timeline-follow').checked = false;
  controller.render();
  assert.equal(query('.timeline-inset').scrollLeft, scroll);
  query('#timeline-follow').checked = true;
  controller.render();
  assert.isAbove(query('.timeline-inset').scrollLeft, scroll);
  state.pause();
  state.clearTimelineSelection();
  controller.render();
  assert.isTrue(query('#timeline-fit-selection').disabled);
  controller.dispose();
});

test('event selection fits its timestamp and replacement session resets view and focused time drafts', () => {
  const { state, controller, query, replace } = fixture();
  state.selectAnimationEvent(state.eventTimelineTrack.markers[0]!.ref);
  controller.fitSelection();
  assert.closeTo(viewportXToTime(250, controller.view), 7.5, 1e-12);
  query('#timeline-time-input').value = 'uncommitted';
  vi.stubGlobal('document', { activeElement: query('#timeline-time-input') });
  controller.render();
  assert.equal(query('#timeline-time-input').value, 'uncommitted');
  dispatch(query('#timeline-time-input'), 'keydown', { key: 'Escape' });
  assert.equal(query('#timeline-time-input').value, '7.5');
  replace(new AnimationEditorState());
  controller.render();
  assert.equal(query('.timeline-inset').scrollLeft, 0);
  assert.equal(query('#timeline-time-input').value, '0');
  assert.isTrue(query('#timeline-time-input').disabled);
  assert.isTrue(query('#timeline-frame-control').hidden);
  controller.dispose();
});

test('a hidden IK endpoint fits through seconds coordinates without changing its authored milliseconds', () => {
  const { controller, query, replace } = fixture();
  const state = new AnimationEditorState(
    new Rig({
      root: 'upper',
      bones: [{ id: 'upper' }, { id: 'lower', parent: 'upper', y: 40 }, { id: 'hand', parent: 'lower', y: 30 }],
      ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' }],
    }),
    [{ name: 'reach', duration: 1000, loop: false, tracks: {}, ikTracks: { arm: [{ time: 1000, x: 20 }] } }],
  );
  state.selectAnimation('reach');
  replace(state);
  controller.render();
  state.ik.selectIKKeyframe({ kind: 'ik', constraintId: 'arm', property: 'x', time: 1 });
  state.setTimelineFilters({ showIK: false });
  const selection = state.ik.selectedIKKeyframe;
  const working = state.workingAnimation;
  controller.render();
  assert.isFalse(query('#timeline-fit-selection').disabled);
  controller.fitSelection();
  assert.equal(controller.view.contentWidth, 4000);
  assert.equal(viewportXToTime(500, controller.view), 1);
  assert.strictEqual(state.ik.selectedIKKeyframe, selection);
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.workingAnimation!.ikTracks!.arm![0]!.time, 1000);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  controller.dispose();
});

test('native change after Enter does not repeat a time/frame jump when a subsequent scrub blurs the field', () => {
  const { state, controller, query } = fixture();
  controller.zoomBy(4);
  for (const [id, value] of [
    ['#timeline-time-input', '4.5'],
    ['#timeline-frame-input', '59'],
  ] as const) {
    const input = query(id);
    input.value = value;
    dispatch(input, 'input');
    dispatch(input, 'keydown', { key: 'Enter' });
    const committedTime = state.currentTime;
    query('.timeline-inset').scrollLeft += 120;
    const scroll = query('.timeline-inset').scrollLeft;
    dispatch(input, 'change');
    assert.equal(query('.timeline-inset').scrollLeft, scroll);
    assert.equal(state.currentTime, committedTime);
    input.value = id === '#timeline-time-input' ? '5' : '60';
    dispatch(input, 'input');
    dispatch(input, 'change');
    assert.equal(state.currentTime, 5);
    assert.closeTo(viewportXToTime(250, controller.view), 5, 1e-12);
  }
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  controller.dispose();
});
