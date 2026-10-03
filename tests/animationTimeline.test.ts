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
