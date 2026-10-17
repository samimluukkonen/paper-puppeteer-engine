import { assert, test, vi } from 'vitest';
import type { GuideRectangle } from '../src/devtools/shared/guides/types.js';
import { observeGuideTarget, type GuideTargetLayout } from '../src/ui/observeGuideTarget.js';

function browser() {
  const events = new EventTarget();
  const visualViewport = new EventTarget();
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  const view = Object.assign(events, {
    innerWidth: 1280,
    innerHeight: 900,
    visualViewport,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      frames.set(++next, callback);
      return next;
    }),
    cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
  });
  const tick = () => {
    const batch = [...frames.values()];
    frames.clear();
    for (const callback of batch) callback(0);
  };
  return { view, tick, frames, window: view as unknown as Window };
}

test('active-step observation follows resize, nested scroll, zoom, and moving provider geometry without redundant renders', () => {
  const browserView = browser();
  let rect: GuideRectangle = { x: 20, y: 30, width: 100, height: 100 };
  const targets = { resolve: vi.fn(() => rect), reveal: vi.fn(() => true) };
  const layouts: GuideTargetLayout[] = [];
  const release = observeGuideTarget(targets, 'canvas', (layout) => layouts.push(layout), browserView.window);
  assert.deepEqual(targets.reveal.mock.calls, [['canvas']]);
  browserView.tick();
  assert.lengthOf(layouts, 1, 'unchanged geometry does not render React every frame');
  rect = { ...rect, x: 40 };
  browserView.tick();
  assert.equal(layouts.at(-1)!.rectangle!.x, 36);
  rect = { ...rect, y: 50 };
  browserView.view.dispatchEvent(new Event('scroll'));
  assert.equal(layouts.at(-1)!.rectangle!.y, 46);
  browserView.view.innerWidth = 1000;
  browserView.view.dispatchEvent(new Event('resize'));
  assert.equal(layouts.at(-1)!.viewport.width, 1000);
  browserView.view.innerHeight = 700;
  browserView.view.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(layouts.at(-1)!.viewport.height, 700);
  rect = { ...rect, y: 100 };
  browserView.view.visualViewport.dispatchEvent(new Event('scroll'));
  assert.equal(layouts.at(-1)!.rectangle!.y, 96);
  release();
});

test('missing/disappearing targets get one safe reveal per disappearance and recover on a later frame', () => {
  const browserView = browser();
  const bounds = { x: 20, y: 30, width: 100, height: 100 };
  let rect: GuideRectangle | null = null;
  const targets = { resolve: () => rect, reveal: vi.fn(() => false) };
  const layouts: GuideTargetLayout[] = [];
  const release = observeGuideTarget(targets, 'panel', (layout) => layouts.push(layout), browserView.window);
  for (let index = 0; index < 10; index++) browserView.tick();
  assert.isNull(layouts.at(-1)!.rectangle);
  assert.lengthOf(targets.reveal.mock.calls, 1, 'do not repeatedly open/scroll a missing panel');
  rect = bounds;
  browserView.tick();
  assert.isNotNull(layouts.at(-1)!.rectangle);
  rect = null;
  targets.reveal.mockImplementation(() => {
    rect = bounds;
    return true;
  });
  browserView.tick();
  assert.lengthOf(targets.reveal.mock.calls, 2);
  browserView.tick();
  assert.isNotNull(layouts.at(-1)!.rectangle, 're-resolve after registered reveal commits');
  release();
});

test('cleanup cancels frames and every event source, including after a step transition', () => {
  const browserView = browser();
  const targets = { resolve: vi.fn(() => ({ x: 20, y: 30, width: 100, height: 100 })), reveal: () => true };
  const layout = vi.fn();
  const release = observeGuideTarget(targets, 'first', layout, browserView.window);
  const pending = [...browserView.frames.values()];
  release();
  assert.equal(browserView.frames.size, 0);
  const calls = targets.resolve.mock.calls.length;
  for (const event of ['resize', 'scroll']) {
    browserView.view.dispatchEvent(new Event(event));
    browserView.view.visualViewport.dispatchEvent(new Event(event));
  }
  for (const callback of pending) callback(0);
  assert.lengthOf(targets.resolve.mock.calls, calls);
  assert.equal(browserView.frames.size, 0);
  const releaseNext = observeGuideTarget(targets, 'next', layout, browserView.window);
  assert.equal(targets.resolve.mock.calls.length, calls + 1);
  releaseNext();
  assert.equal(browserView.frames.size, 0);
});
