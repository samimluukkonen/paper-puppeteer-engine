import { assert, test } from 'vitest';
import { generateRulerTicks } from '../src/devtools/animation-editor/timeline.js';
import {
  centerTimelineTime,
  clampTimelineZoom,
  fitTimelineAnimation,
  fitTimelineSelection,
  followTimelineTime,
  panTimeline,
  timelineFrameToTime,
  timelineTimeToFrame,
  type TimelineViewport,
  timeToViewportX,
  viewportXToTime,
  zoomTimeline,
} from '../src/devtools/animation-editor/timelineNavigation.js';

const view: TimelineViewport = { duration: 10, viewportWidth: 500, contentWidth: 2000, scrollLeft: 400 };

test('content and viewport conversions share continuous time and native pan offsets', () => {
  assert.equal(timeToViewportX(3, view), 200);
  assert.equal(viewportXToTime(200, view), 3);
  for (const viewportWidth of [99.25, 500, 1400]) {
    const viewport = { ...view, viewportWidth, contentWidth: viewportWidth * 16, scrollLeft: viewportWidth * 3 };
    const time = 2.987654321;
    assert.closeTo(viewportXToTime(timeToViewportX(time, viewport), viewport), time, 1e-12);
  }
  assert.equal(viewportXToTime(-1000, view), 0);
  assert.equal(viewportXToTime(10000, view), 10);
  assert.equal(panTimeline(view, -10), 0);
  assert.equal(panTimeline(view, 10000), 1500);
  assert.equal(panTimeline(view, 600.5), 600.5);
  assert.equal(panTimeline(view, NaN), 0);
});

test('zoom preserves pointer time in both directions, with clamping at content boundaries', () => {
  for (const anchor of [0, 175.25, 500]) {
    const time = viewportXToTime(anchor, view);
    const zoomed = zoomTimeline(view, 8, anchor);
    assert.closeTo(viewportXToTime(anchor, zoomed), time, 1e-12);
    const restored = zoomTimeline(zoomed, 4, anchor);
    assert.closeTo(restored.scrollLeft, view.scrollLeft, 1e-12);
  }
  assert.equal(zoomTimeline(view, 1, 250).scrollLeft, 0);
  assert.equal(clampTimelineZoom(0), 1);
  assert.equal(clampTimelineZoom(1000), 128);
  assert.equal(clampTimelineZoom(NaN), 1);
  assert.equal(clampTimelineZoom(Infinity), 128);
  assert.equal(clampTimelineZoom(-Infinity), 1);
  assert.equal(fitTimelineSelection(view, [0, 1e-320])!.contentWidth, 500 * 128);
  const end = { ...view, scrollLeft: 1500 };
  const zoomed = zoomTimeline(end, 128, 500);
  assert.equal(viewportXToTime(500, zoomed), 10);
  assert.equal(viewportXToTime(0, zoomTimeline({ ...view, scrollLeft: 0 }, 128, 0)), 0);
});

test('fit entire, fit selection and center retain endpoints and full cross-track ranges', () => {
  assert.deepEqual(fitTimelineAnimation(view), { ...view, contentWidth: 500, scrollLeft: 0 });
  assert.isNull(fitTimelineSelection(view, []));
  assert.isNull(fitTimelineSelection(view, [NaN, -1, 11]));
  const fit = fitTimelineSelection(view, [4.25, 5, 4.5, 4.25])!;
  assert.closeTo(timeToViewportX(4.25, fit), 50, 1e-10);
  assert.closeTo(timeToViewportX(5, fit), 450, 1e-10);
  assert.equal(centerTimelineTime(view, 0), 0);
  assert.equal(centerTimelineTime(view, 10), 1500);
  assert.equal(centerTimelineTime(view, 5), 750);
  for (const times of [[0], [10], [0, 10], [4, 4.00001]]) {
    const result = fitTimelineSelection(view, times)!;
    assert.isAtLeast(result.contentWidth / result.viewportWidth, 1);
    assert.isAtMost(result.contentWidth / result.viewportWidth, 128);
    assert.isTrue(
      times.every((time) => timeToViewportX(time, result) >= -1e-9 && timeToViewportX(time, result) <= 500 + 1e-9),
    );
  }
});

test.each([0, 0.00001, 3600])('navigation remains finite at duration %s and never mutates input', (duration) => {
  const viewport = Object.freeze({ ...view, duration });
  const before = JSON.stringify(viewport);
  const zoomed = zoomTimeline(viewport, 128, 200);
  const fit = fitTimelineSelection(zoomed, [0, duration])!;
  for (const value of [
    zoomed.scrollLeft,
    fit.scrollLeft,
    centerTimelineTime(zoomed, duration),
    followTimelineTime(zoomed, duration),
  ])
    assert.isTrue(Number.isFinite(value));
  assert.equal(viewportXToTime(-100, fit), 0);
  assert.equal(viewportXToTime(1e10, fit), duration);
  assert.equal(JSON.stringify(viewport), before);
});

test('follow moves near viewport edges and leaves a comfortably visible playhead alone', () => {
  assert.equal(followTimelineTime(view, 3), 400);
  assert.isAbove(followTimelineTime(view, 4.4), 400);
  assert.isBelow(followTimelineTime(view, 2.1), 400);
  assert.equal(followTimelineTime(view, 0), 0);
  assert.equal(followTimelineTime(view, 10), 1500);
});

test.each([8, 10, 12, 60, 29.97])('zero-based frame navigation at %s FPS follows runtime boundaries', (fps) => {
  for (const frame of [0, 1, 3, 20]) {
    const time = timelineFrameToTime(frame, 10, fps)!;
    assert.closeTo(time, frame / fps, 1e-12);
    assert.equal(timelineTimeToFrame(time, 10, fps), frame);
    assert.equal(timelineTimeToFrame(time + 0.4 / fps, 10, fps), frame);
  }
  assert.equal(timelineFrameToTime(-1, 10, fps), 0);
  assert.equal(timelineFrameToTime(1000000, 10, fps), 10);
  assert.equal(timelineFrameToTime(0, 0, fps), 0);
  assert.equal(timelineFrameToTime(1.5, 10, fps), null);
  assert.equal(timelineFrameToTime(NaN, 10, fps), null);
});

test.each([0, -1, NaN, Infinity])('invalid FPS %s has no frame navigation', (fps) => {
  assert.isNull(timelineFrameToTime(1, 10, fps));
  assert.isNull(timelineTimeToFrame(1, 10, fps));
});

test('ruler ticks cover a zoomed visible range without allocating ticks for the entire long clip', () => {
  const ticks = generateRulerTicks(3600, 64000, 1790, 1820);
  assert.isBelow(ticks.length, 50);
  assert.isAtMost(generateRulerTicks(3600, 64000).length, 401);
  assert.isTrue(ticks.some((tick) => tick.time === 1800 && tick.major));
  assert.equal(ticks[0]!.time, 0);
  assert.equal(ticks.at(-1)!.time, 3600);
  assert.isTrue(ticks.every((tick, index) => index === 0 || tick.time > ticks[index - 1]!.time));
});
