import { assert, test } from 'vitest';
import {
  animationDurationSeconds,
  clampTime,
  generateRulerTicks,
  timelineXToTime,
  timeToTimelineX,
} from '../src/devtools/animation-editor/timeline.js';

test.each([-10, 0, 0.123456789, 1, 2, 10, Infinity, -Infinity, NaN])('time %s clamps to valid range', (time) => {
  const actual = clampTime(time, 2);
  assert.isTrue(actual >= 0 && actual <= 2);
  if (Number.isFinite(time) && time >= 0 && time <= 2) assert.equal(actual, time);
});

test('coordinate conversion preserves continuous seconds and clamps outside the timeline', () => {
  assert.equal(timeToTimelineX(0.75, 2, 800), 300);
  assert.equal(timelineXToTime(300, 2, 800), 0.75);
  assert.equal(timelineXToTime(-25, 2, 800), 0);
  assert.equal(timelineXToTime(900, 2, 800), 2);
  assert.equal(timeToTimelineX(10, 2, 800), 800);
  for (const width of [200, 650, 1200]) {
    const time = 0.74212345;
    assert.approximately(timelineXToTime(timeToTimelineX(time, 1.8, width), 1.8, width), time, 1e-12);
  }
});

test.each([0, -1, NaN, Infinity])('degenerate duration or width %s has no usable timeline extent', (value) => {
  assert.equal(clampTime(0.5, value), 0);
  assert.equal(timeToTimelineX(1, 0, value), 0);
  assert.equal(timelineXToTime(1, 0, value), 0);
  assert.equal(timeToTimelineX(1, 2, value), 0);
  assert.equal(timelineXToTime(1, 2, value), 0);
});

test('explicit runtime duration is authoritative for empty, partial, and event-only clips', () => {
  assert.equal(animationDurationSeconds(null), 0);
  assert.equal(animationDurationSeconds({ duration: 0 }), 0);
  for (const tracks of [{}, { root: [{ time: 500, x: 1 }] }]) {
    const animation = { duration: 2000, tracks, events: [{ time: 2000, name: 'end' }] };
    const before = JSON.stringify(animation);
    assert.equal(animationDurationSeconds(animation), 2);
    assert.equal(JSON.stringify(animation), before);
  }
});

test.each([0.001, 0.1, 0.25, 1.8, 2, 7.42, 60, 3600, 1e20])('ruler adapts to duration %s and width', (duration) => {
  for (const width of [80, 240, 800, 1600]) {
    const ticks = generateRulerTicks(duration, width);
    assert.equal(ticks[0]!.time, 0);
    assert.equal(ticks[ticks.length - 1]!.time, duration);
    assert.isTrue(ticks.length <= 401);
    assert.isTrue(ticks.every((tick, index) => index === 0 || tick.time > ticks[index - 1]!.time));
    assert.isTrue(ticks.every((tick) => tick.time >= 0 && tick.time <= duration));
    assert.isTrue(ticks.filter((tick) => tick.major).every((tick) => tick.label?.endsWith(' s')));
    assert.isTrue(ticks.filter((tick) => !tick.major).every((tick) => tick.label === null));
    assert.deepEqual([...ticks], [...generateRulerTicks(duration, width)]);
  }
});

test('ruler includes major labels, minor subdivisions and a single exact end marker', () => {
  const ticks = generateRulerTicks(2, 640);
  assert.includeDeepMembers(
    [...ticks],
    [
      { time: 0.25, major: true, label: '0.25 s' },
      { time: 0.0625, major: false, label: null },
      { time: 2, major: true, label: '2 s' },
    ],
  );
  assert.lengthOf(
    ticks.filter((tick) => tick.time === 2),
    1,
  );
  assert.lengthOf(generateRulerTicks(0, 800), 1);
  assert.lengthOf(generateRulerTicks(2, 0), 1);
});
