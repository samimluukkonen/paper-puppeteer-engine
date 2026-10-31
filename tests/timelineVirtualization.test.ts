import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { keysInMarquee } from '../src/devtools/animation-editor/keyframeSelection.js';
import {
  timelineKeysInRange,
  timelineRowLayout,
  timelineRowWindow,
} from '../src/devtools/animation-editor/timelineVirtualization.js';
import { Rig } from '../src/engine/Rig.js';

test('time window includes coincident keys and endpoints without scanning offscreen keys', () => {
  let reads = 0;
  const keys = Array.from({ length: 100_000 }, (_, index) => ({
    get time() {
      reads++;
      return Math.floor(index / 2);
    },
  }));
  assert.lengthOf(timelineKeysInRange(keys, 10_000, 10_002), 6);
  assert.isBelow(reads, 40);
  assert.deepEqual(timelineKeysInRange(keys, -10, -1), []);
  assert.deepEqual(timelineKeysInRange(keys, 50_000, 60_000), []);
  assert.lengthOf(timelineKeysInRange(keys, 49_999, 50_000), 2);
  assert.deepEqual(timelineKeysInRange([], 0, 0), []);
});

test('row windows account for prefix lanes, overscan, and content shrinking after filtering', () => {
  assert.deepEqual(timelineRowWindow(1000, 0, 300, 120), { first: 0, end: 8 });
  assert.deepEqual(timelineRowWindow(1000, 3120, 300, 120), { first: 98, end: 112 });
  assert.deepEqual(timelineRowWindow(4, 3120, 300, 120), { first: 4, end: 4 });
  assert.deepEqual(timelineRowWindow(0, 0, 300, 120), { first: 0, end: 0 });
});

test('filtered model row indices preserve marquee and adjacent-key selection without mounted elements', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'child', parent: 'root' }] });
  const state = new AnimationEditorState(rig, [
    {
      name: 'dense',
      duration: 100_000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 1 },
          { time: 99_000, x: 2 },
        ],
        child: [{ time: 50_000, y: 3 }],
      },
    },
  ]);
  state.selectAnimation('dense');
  state.expandTimeline('all');
  state.setTimelineFilters({ ...state.timelineFilters, search: 'y' });
  const tracks = state.timelineTracks;
  const visible = state.timelineVisibility.rows;
  const layout = timelineRowLayout(tracks, visible);
  const child = layout.find(({ track }) => track.kind === 'property' && track.boneId === 'child')!;
  assert.isAbove(child.index, layout.indexOf(child));
  const box = { firstRow: child.index, lastRow: child.index, startTime: 0, endTime: 100 };
  const expected = [{ boneId: 'child', property: 'y', time: 50, value: 3 }] as const;
  assert.deepEqual(keysInMarquee(tracks, box, visible), expected);
  state.selectKeyframeMarquee(box);
  assert.equal(state.primaryKey?.time, 50);
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  assert.isTrue(state.selectAdjacentKeyframe(1));
  assert.equal(state.primaryKey?.time, 99);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
});
