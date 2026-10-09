import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  compareEvaluatedAnimationPoses,
  importAnimationJson,
  verifyAnimationRoundTrip,
} from '../src/devtools/animation-editor/animationImport.js';
import { serializeAnimation } from '../src/devtools/animation-editor/animationSerialization.js';
import { compileClip } from '../src/engine/AnimationClip.js';
import type { FiredAnimationEvent } from '../src/engine/AnimationPlayer.js';
import { collectAnimationEvents, collectAnimationStartEvents } from '../src/engine/animationTimeline.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import type { AnimationJsonDefinition } from '../src/engine/externalData.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { transformProperties } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root', x: 3 }] });
const animation = (): AnimationJsonDefinition => ({
  version: 1,
  name: 'walk',
  duration: 1033,
  loop: false,
  interpolation: 'linear',
  tracks: {
    root: [
      { time: 0, x: 0.1 + 0.2, rotation: 3.1 },
      { time: 300, y: 1 / 3 },
      { time: 1033, x: 9, rotation: -3.1 },
    ],
    arm: [
      { time: 100, scaleX: -1, scaleY: 0.2 },
      { time: 900, scaleX: 2, scaleY: 0.9 },
    ],
  },
  events: [
    { time: 1033, name: 'end', data: { n: 1 / 3 } },
    { time: 0, name: 'start' },
    { time: 300, name: 'first', data: { b: [null, true, { n: 0.1 + 0.2 }], a: 1 } },
    { time: 300, name: 'second', data: null },
    { time: 300, name: 'second', data: null },
  ],
});

test.each(['implicit', 'smooth', 'stepped'] as const)(
  'round-trip compares raw/interpolated and %s playback poses at keys, midpoints, frame holds and endpoints',
  (mode) => {
    const source = animation();
    if (mode === 'smooth') source.playback = { mode: 'smooth' };
    if (mode === 'stepped') source.playback = { mode: 'stepped', fps: 12.5 };
    const result = verifyAnimationRoundTrip(source, rig);
    assert.isTrue(result.success);
    if (!result.success) return;
    assert.isTrue(result.equivalent);
    assert.isTrue(result.posesEquivalent);
    assert.isTrue(result.playbackEquivalent);
    for (const time of [0, 100, 300, 900, 1033, 50, 200, 600, 966.5]) assert.include(result.sampleTimes, time);
    assert.isTrue(result.sampleTimes.some((time) => time < 1033 && time > 1032));
    if (mode === 'stepped') for (const time of [40, 80, 240, 280, 320]) assert.include(result.sampleTimes, time);
    const changed = { ...result.data, tracks: { ...result.data.tracks, root: [{ time: 0, x: 99 }] } };
    assert.isFalse(compareEvaluatedAnimationPoses(source, changed, rig).posesEquivalent);
  },
);

test('comparison catches playback differences even when unquantized authored poses match', () => {
  const source = animation();
  const result = compareEvaluatedAnimationPoses(source, { ...source, playback: { mode: 'stepped', fps: 10 } }, rig);
  assert.isTrue(result.posesEquivalent);
  assert.isFalse(result.playbackEquivalent);
});

test.each([false, true])(
  'event dispatch ordering, endpoint/start crossings and payloads survive round-trip with loop=%s',
  (loop) => {
    const source = { ...animation(), loop, playback: { mode: 'stepped' as const, fps: 12.5 } };
    const result = verifyAnimationRoundTrip(source, rig);
    assert.isTrue(result.success);
    if (!result.success) return;
    const before = compileClip(source, rig);
    const after = compileClip(result.data, rig);
    assert.deepEqual(after.events, before.events);
    assert.deepEqual(collectAnimationStartEvents(after, 'base'), collectAnimationStartEvents(before, 'base'));
    for (const [start, end] of [
      [0, 300],
      [300, 1033],
      [0, 1033],
      [1033, 2066],
      [0, 3100],
    ])
      assert.deepEqual(
        collectAnimationEvents(after, start!, end!, 'base'),
        collectAnimationEvents(before, start!, end!, 'base'),
      );
    assert.deepEqual(
      collectAnimationEvents(after, 0, 1033, 'base').map((event) => event.name),
      loop ? ['first', 'second', 'second', 'start', 'end'] : ['first', 'second', 'second', 'end'],
    );
    const state = new AnimationEditorState(rig);
    const fired = vi.fn<(event: FiredAnimationEvent) => void>();
    state.onAnimationEvent(fired);
    state.importJson(result.json);
    state.setPreviewLoop(loop);
    assert.equal(fired.mock.calls.length, 0);
    state.play();
    state.advancePlayback(1.033);
    assert.deepEqual(
      fired.mock.calls.map(([event]) => event),
      [...collectAnimationStartEvents(after, 'base'), ...collectAnimationEvents(after, 0, 1033, 'base')],
    );
  },
);

test('canonical floats stabilize on the first pass, including tiny and nearby times over 20 cycles', () => {
  const source = animation();
  source.tracks = {
    ...source.tracks,
    root: [
      { time: 0.3, x: 0.1 + 0.2, y: 1e-12 },
      { time: 0.30000000000000004, x: 1 / 3 },
      { time: 1033, x: 1.234567891234567 },
    ],
  };
  source.playback = { mode: 'stepped', fps: 10.000000000000002 };
  const first = serializeAnimation(source, rig);
  assert.isTrue(first.success);
  if (!first.success) return;
  let json = first.json;
  for (let i = 0; i < 20; ++i) {
    const imported = importAnimationJson(json, rig);
    assert.isTrue(imported.success);
    if (!imported.success) return;
    const exported = serializeAnimation(imported.data, rig);
    assert.isTrue(exported.success);
    if (!exported.success) return;
    assert.equal(exported.json, first.json);
    json = exported.json;
  }
});

test('empty and single-key clips are valid; zero duration and wrong/unknown document fields reject safely', () => {
  for (const tracks of [{}, { root: [{ time: 0, x: 3 }] }]) {
    const result = verifyAnimationRoundTrip({ ...animation(), tracks, events: [] }, rig);
    assert.isTrue(result.success && result.equivalent);
  }
  for (const json of [
    '',
    ' \n ',
    JSON.stringify({ ...animation(), duration: 0, tracks: {}, events: [] }),
    JSON.stringify({ version: 1, root: 'root', bones: [{ id: 'root' }] }),
    JSON.stringify({ version: 1, name: 'pose', bones: {} }),
    JSON.stringify({ ...animation(), extra: 'unsupported' }),
  ]) {
    const state = new AnimationEditorState(rig, [animation()]);
    state.selectAnimation('walk');
    state.setBonePropertyKeyframe('root', 'x', 55);
    const before = state.workingAnimation;
    assert.isFalse(state.importJson(json));
    assert.strictEqual(state.workingAnimation, before);
    assert.isTrue(state.canUndo);
    assert.isTrue(state.dirty);
    assert.isNotEmpty(state.validationIssues);
  }
});

test('larger animation with 32 tracks, 128 keys per track and 256 events imports, builds timeline and round-trips', () => {
  const bones = Array.from({ length: 32 }, (_, index) => ({
    id: `bone${index}`,
    ...(index ? { parent: 'bone0' } : {}),
  }));
  const largeRig = new Rig({ root: 'bone0', bones });
  const source: AnimationJsonDefinition = {
    version: 1,
    name: 'large',
    duration: 12700,
    loop: true,
    tracks: Object.fromEntries(
      bones.map((bone) => [
        bone.id,
        Array.from({ length: 128 }, (_, key) => ({ time: key * 100, x: key / 3, rotation: key / 100 })),
      ]),
    ),
    events: Array.from({ length: 256 }, (_, index) => ({ time: index * 49, name: `event${index}`, data: { index } })),
  };
  const state = new AnimationEditorState(largeRig);
  assert.isTrue(state.importJson(JSON.stringify(source)));
  for (const bone of bones) state.setTimelineBoneExpanded(bone.id, true);
  assert.equal(state.timelineTracks.filter((row) => row.kind === 'property').length, 32 * transformProperties.length);
  assert.equal(state.eventTimelineTrack.markers.length, 256);
  const result = verifyAnimationRoundTrip(state.workingAnimation, largeRig);
  assert.isTrue(result.success && result.equivalent);
});

test('exported walk.json loads from a normal on-disk character folder and plays through Puppet without conversion', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'animation-workflow-'));
  const fetcher: typeof fetch = async (input) =>
    new Response(
      await readFile(
        new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url),
        'utf8',
      ),
    );
  try {
    await mkdir(join(folder, 'animations'));
    await writeFile(
      join(folder, 'character.json'),
      JSON.stringify({
        version: 1,
        id: 'production',
        rig: 'rig.json',
        defaultSkin: 'default',
        skins: { default: 'skin.json' },
        animations: ['animations/walk.json'],
        textures: {},
      }),
    );
    await writeFile(
      join(folder, 'rig.json'),
      JSON.stringify({ version: 1, root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root', x: 3 }] }),
    );
    await writeFile(join(folder, 'skin.json'), JSON.stringify({ version: 1, name: 'default', slots: {} }));
    const source = { ...animation(), playback: { mode: 'stepped' as const, fps: 12.5 } };
    const state = new AnimationEditorState(rig, [source], { animationPaths: { walk: 'animations/walk.json' } });
    state.selectAnimation('walk');
    state.setBonePropertyKeyframe('root', 'y', 7, 0.2);
    await writeFile(join(folder, 'animations', state.selectedAnimationFilename!), state.exportJson());
    const definition = await CharacterLoader.load(pathToFileURL(join(folder, 'character.json')).href, fetcher);
    assert.equal(definition.animationPaths.walk, 'animations/walk.json');
    const comparison = compareEvaluatedAnimationPoses(state.workingAnimation!, definition.animations[0]!, rig);
    assert.isTrue(comparison.posesEquivalent && comparison.playbackEquivalent);
    const puppet = new Puppet(puppetScene(), { definition, autoUpdate: false });
    const fired = vi.fn<(event: FiredAnimationEvent) => void>();
    puppet.onAnimationEvent(fired);
    puppet.play('walk');
    for (const time of comparison.sampleTimes) {
      puppet.sampleAnimation(time, { mode: 'playback' });
      for (const bone of rig.bones) {
        const expected = state.getEvaluatedBoneTransform(bone.id, time / 1000)!;
        for (const property of transformProperties)
          assert.approximately(puppet.getBone(bone.id).pose[property], expected[property], 1e-10);
      }
    }
    assert.deepEqual(
      fired.mock.calls.map(([event]) => event.name),
      ['start'],
    );
    puppet.destroy();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
