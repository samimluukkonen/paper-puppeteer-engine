import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { TimelineKeyboardController } from '../src/devtools/animation-editor/TimelineKeyboardController.js';
import { Rig } from '../src/engine/Rig.js';

afterEach(() => vi.unstubAllGlobals());

class KeyboardElement extends EventTarget {
  tagName = 'DIV';
  isContentEditable = false;
  panel = false;
  closest(selector: string) {
    return selector === '.timeline-panel' && this.panel ? this : null;
  }
  contains(element: Element): boolean {
    return element === (this as unknown as Element);
  }
}

function createState() {
  const state = new AnimationEditorState(new Rig({ root: 'root', bones: [{ id: 'root' }] }), [
    { name: 'move', duration: 1000, loop: false, tracks: { root: [{ time: 0, x: 1 }] } },
  ]);
  state.selectAnimation('move');
  return state;
}

function fixture() {
  const browser = new EventTarget();
  const app = new KeyboardElement();
  const timeline = new KeyboardElement();
  const ruler = new KeyboardElement();
  const gestures = { cancelGesture: vi.fn(), hasMarquee: vi.fn(() => false) };
  let state = createState();
  vi.stubGlobal('window', browser);
  vi.stubGlobal('Element', KeyboardElement);
  const keyboard = new TimelineKeyboardController(
    app as unknown as HTMLElement,
    timeline as unknown as HTMLElement,
    () => state,
    ruler as unknown as HTMLElement,
    gestures,
  );
  return {
    browser,
    app,
    timeline,
    ruler,
    gestures,
    keyboard,
    get state() {
      return state;
    },
    replace() {
      state = createState();
    },
  };
}

const key = (name: string, extra = {}, target?: EventTarget) => {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key: name, ...extra });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
};

test('clipboard shortcuts stay scoped to the timeline and preserve native guarded input', () => {
  const { browser, app, state, keyboard } = fixture();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  const copy = vi.spyOn(state, 'copyTimelineSelection');
  const outside = key('c', { ctrlKey: true }, app);
  browser.dispatchEvent(outside);
  assert.isFalse(outside.defaultPrevented);
  const unrelated = new KeyboardElement();
  unrelated.panel = true;
  const elsewhere = key('c', { ctrlKey: true }, unrelated);
  browser.dispatchEvent(elsewhere);
  assert.isFalse(elsewhere.defaultPrevented);
  app.panel = true;
  for (const guard of [{ isComposing: true }, { altKey: true }, { shiftKey: true }]) {
    const ignored = key('c', { ctrlKey: true, ...guard }, app);
    browser.dispatchEvent(ignored);
    assert.isFalse(ignored.defaultPrevented);
  }
  for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) {
    app.tagName = tag;
    const typing = key('c', { ctrlKey: true }, app);
    browser.dispatchEvent(typing);
    assert.isFalse(typing.defaultPrevented);
  }
  app.tagName = 'DIV';
  app.isContentEditable = true;
  browser.dispatchEvent(key('c', { ctrlKey: true }, app));
  app.isContentEditable = false;
  const consumed = key('c', { ctrlKey: true }, app);
  consumed.preventDefault();
  browser.dispatchEvent(consumed);
  assert.equal(copy.mock.calls.length, 0);
  const accepted = key('c', { metaKey: true }, app);
  browser.dispatchEvent(accepted);
  assert.isTrue(accepted.defaultPrevented);
  assert.equal(copy.mock.calls.length, 1);
  const repeated = key('c', { metaKey: true, repeat: true }, app);
  browser.dispatchEvent(repeated);
  assert.isTrue(repeated.defaultPrevented);
  assert.equal(copy.mock.calls.length, 1);
  keyboard.dispose();
});

test('Escape cancels active gestures while empty selection clears normally', () => {
  const { browser, state, gestures, keyboard } = fixture();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  gestures.hasMarquee.mockReturnValue(true);
  browser.dispatchEvent(key('Escape'));
  assert.equal(gestures.cancelGesture.mock.calls.length, 1);
  assert.isNotNull(state.selectedKeyframe);
  gestures.hasMarquee.mockReturnValue(false);
  state.beginKeyframeDrag(state.selectedKeyframe);
  browser.dispatchEvent(key('Escape'));
  assert.equal(gestures.cancelGesture.mock.calls.length, 2);
  state.cancelKeyframeDrag();
  browser.dispatchEvent(key('Escape'));
  assert.isNull(state.selectedKeyframe);
  keyboard.dispose();
});

test('navigation follows replacement sessions and disposal releases global, track and ruler listeners', () => {
  const fixtureState = fixture();
  const { browser, timeline, ruler, keyboard } = fixtureState;
  const previous = fixtureState.state;
  fixtureState.replace();
  const current = fixtureState.state;
  browser.dispatchEvent(key(' ', { code: 'Space' }));
  assert.isTrue(current.isPlaying);
  assert.isFalse(previous.isPlaying);
  current.pause();
  timeline.dispatchEvent(key('ArrowRight'));
  assert.closeTo(current.currentTime, 0.01, 1e-9);
  ruler.dispatchEvent(key('End'));
  assert.equal(current.currentTime, 1);
  keyboard.dispose();
  keyboard.dispose();
  const global = key(' ', { code: 'Space' });
  const track = key('ArrowLeft');
  const slider = key('Home');
  browser.dispatchEvent(global);
  timeline.dispatchEvent(track);
  ruler.dispatchEvent(slider);
  assert.isFalse(current.isPlaying);
  assert.equal(current.currentTime, 1);
  assert.isFalse(global.defaultPrevented || track.defaultPrevented || slider.defaultPrevented);
});
