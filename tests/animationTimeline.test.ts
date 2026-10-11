import { assert, test } from 'vitest';
import { compileClip } from '../src/engine/AnimationClip.js';
import { advanceAnimationTime, collectAnimationEvents, countAnimationEvents } from '../src/engine/animationTimeline.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
const clip = (loop: boolean) =>
  compileClip(
    {
      name: 'steps',
      duration: 100,
      loop,
      tracks: {},
      events: [
        { time: 0, name: 'cycle' },
        { time: 20, name: 'left' },
        { time: 70, name: 'right' },
      ],
    },
    rig,
  );

test.each([false, true])('clock calculation preserves its inputs and clamps only nonloops (loop: %s)', (loop) => {
  const clock = Object.freeze({ clip: clip(loop), time: 20, speed: 2 });
  assert.equal(advanceAnimationTime(clock, 100, 0.5), loop ? 120 : 100);
  assert.equal(clock.time, 20);
  assert.equal(advanceAnimationTime(clock, Number.MAX_VALUE, 0), 20);
  assert.equal(advanceAnimationTime({ ...clock, speed: 0 }, Number.MAX_VALUE, Number.MAX_VALUE), 20);
  assert.throws(() => advanceAnimationTime(clock, Number.MAX_VALUE, 2), /advancement distance.*finite/);
});

test('event counting and collection agree across multiple wraps and exclude the previous boundary', () => {
  const compiled = clip(true);
  const events = collectAnimationEvents(compiled, 20, 220, 'upper');
  assert.equal(countAnimationEvents(compiled, 20, 220), events.length);
  assert.deepEqual(
    events.map(({ name }) => name),
    ['right', 'cycle', 'left', 'right', 'cycle', 'left'],
  );
  for (const event of events)
    assert.deepEqual({ clip: event.clip, layer: event.layer }, { clip: 'steps', layer: 'upper' });
  assert.equal(countAnimationEvents(compiled, 20, 20), 0);
  assert.deepEqual(collectAnimationEvents(compiled, 20, 20, 'upper'), []);
  assert.equal(compiled.events[0]!.name, 'cycle');
});

test('nonlooping event collection never repeats markers or start events', () => {
  const compiled = clip(false);
  assert.equal(countAnimationEvents(compiled, 0, 100), 2);
  assert.deepEqual(
    collectAnimationEvents(compiled, 0, 100, 'base').map(({ name }) => name),
    ['left', 'right'],
  );
  assert.deepEqual(collectAnimationEvents(compiled, 100, 200, 'base'), []);
});

test.each([0.1, 0.3, 0.4, 0.5, 1000])(
  'fractional crossings agree with direct comparisons for duration %s',
  (duration) => {
    const compiled = compileClip(
      {
        name: 'fractional',
        duration,
        loop: true,
        tracks: {},
        events: [
          { time: duration / 3, name: 'marker' },
          { time: duration, name: 'end' },
        ],
      },
      rig,
    );
    for (let cycle = 0; cycle < 8; ++cycle) {
      for (const event of compiled.events) {
        const end = cycle * duration + event.time;
        const previous = Math.max(0, end - duration);
        const expected = compiled.events.reduce(
          (count, marker) =>
            count +
            Array.from({ length: 10 }, (_, index) => index * duration + marker.time).filter(
              (time) => time > previous && time <= end,
            ).length,
          0,
        );
        assert.equal(countAnimationEvents(compiled, previous, end), expected);
        assert.equal(collectAnimationEvents(compiled, previous, end, 'base').length, expected);
      }
    }
  },
);

test('loop crossings include exact fractional boundaries without firing early or replaying the lower bound', () => {
  const compiled = compileClip(
    { name: 'fractional', duration: 1000, loop: true, tracks: {}, events: [{ time: 100.1, name: 'marker' }] },
    rig,
  );
  const boundary = 1000 + 100.1;
  const before = boundary - Number.EPSILON * boundary;
  assert.equal(countAnimationEvents(compiled, 0, before), 1);
  assert.equal(collectAnimationEvents(compiled, 0, before, 'base').length, 1);
  assert.equal(countAnimationEvents(compiled, 0, boundary), 2);
  assert.equal(collectAnimationEvents(compiled, 0, boundary, 'base').length, 2);
  assert.equal(countAnimationEvents(compiled, boundary, boundary + 1), 0);
  assert.isEmpty(collectAnimationEvents(compiled, boundary, boundary + 1, 'base'));
});
