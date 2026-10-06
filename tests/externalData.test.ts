import { assert, test } from 'vitest';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import {
  type AnimationJsonDefinition,
  AnimationValidationError,
  parseAnimationClip,
  parseRigDefinition,
  type RigJsonDefinition,
  RigValidationError,
  UnsupportedFormatVersionError,
  validateAnimationDefinition,
  validateRigDefinition,
} from '../src/engine/externalData.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';

const rigFile: RigJsonDefinition = {
  version: 1,
  name: 'test',
  root: 'root',
  bones: [
    { id: 'tip', parent: 'arm', x: 0, y: 12, rotation: 0.1, scaleX: 1.2, scaleY: 0.8 },
    { id: 'root', sprite: { texture: 'body', x: 2, y: 3, originX: 0.25, originY: 0.75, depth: 2 } },
    { id: 'arm', parent: 'root', x: 10, length: 12, depth: -1 },
  ],
};

const clipFile: AnimationJsonDefinition = {
  version: 1,
  name: 'move',
  duration: 1000,
  loop: true,
  playback: { mode: 'stepped', fps: 10 },
  tracks: {
    arm: [
      { time: 0, x: 0, rotation: 0 },
      { time: 1000, x: 100, rotation: 1 },
    ],
  },
  events: [{ time: 250, name: 'step', data: { side: 'left', count: 1 } }],
};

test('parsed JSON event payloads are independent of source objects in both directions', () => {
  const file = {
    ...clipFile,
    events: [{ time: 0, name: 'hit', data: { nested: { values: [1] } } }],
  };
  const clip = parseAnimationClip(file, new Rig(rigFile));
  const data = clip.events![0]!.data as { nested: { values: number[] } };
  file.events[0]!.data.nested.values.push(2);
  assert.deepEqual(data.nested.values, [1]);
  data.nested.values.push(3);
  assert.deepEqual(file.events[0]!.data.nested.values, [1, 2]);
});

test('file validators reject root and nested accessors without invoking getters', () => {
  const rig = new Rig(rigFile);
  for (const field of ['version', 'bones', 'root']) {
    let reads = 0;
    const input = Object.defineProperty({ ...rigFile }, field, {
      enumerable: true,
      get() {
        reads++;
        throw new Error('getter invoked');
      },
    });
    assert.ok(validateRigDefinition(input).some((issue) => issue.path === field && /accessor/.test(issue.message)));
    assert.throws(() => parseRigDefinition(input), RigValidationError);
    assert.equal(reads, 0);
  }
  for (const field of ['version', 'tracks', 'name']) {
    let reads = 0;
    const input = Object.defineProperty({ ...clipFile }, field, {
      enumerable: true,
      get() {
        reads++;
        throw new Error('getter invoked');
      },
    });
    assert.ok(
      validateAnimationDefinition(input, rig).some((issue) => issue.path === field && /accessor/.test(issue.message)),
    );
    assert.throws(() => parseAnimationClip(input, rig), AnimationValidationError);
    assert.equal(reads, 0);
  }
  const nested = Object.defineProperty({ id: 'root' }, 'x', {
    enumerable: true,
    get() {
      throw new Error('getter invoked');
    },
  });
  assert.throws(() => parseRigDefinition({ ...rigFile, bones: [nested] }), RigValidationError);
  const inherited: unknown = Object.create({
    get version() {
      throw new Error('inherited getter invoked');
    },
  });
  assert.throws(() => parseRigDefinition(inherited), RigValidationError);
  assert.throws(() => parseAnimationClip(inherited, rig), AnimationValidationError);
  const coercion = { toString: 'invalid coercion' };
  assert.throws(() => parseRigDefinition({ ...rigFile, version: coercion }), UnsupportedFormatVersionError);
});

test('versioned rig round trips through JSON into the runtime rig', () => {
  const rig = parseRigDefinition(JSON.parse(JSON.stringify(rigFile)));
  assert.deepEqual(
    rig.bones.map((bone) => bone.id),
    ['root', 'arm', 'tip'],
  );
  assert.strictEqual(rig.getBone('root').sprite?.originX, 0.25);
  assert.strictEqual(rig.getBone('arm').depth, -1);
  assert.strictEqual(rig.getBone('tip').y, 12);
  assert.deepEqual(validateRigDefinition(rigFile), []);
});

test('rig validation reports duplicate, missing parent, missing root and cycles', () => {
  const broken = {
    version: 1,
    root: 'missing',
    bones: [
      { id: 'a', parent: 'b' },
      { id: 'a', parent: 'b' },
      { id: 'b', parent: 'a' },
      { id: 'orphan', parent: 'absent' },
    ],
  };
  const issues = validateRigDefinition(broken);
  assert.ok(issues.some((issue) => issue.path === 'bones[1].id' && /Duplicate/.test(issue.message)));
  assert.ok(issues.some((issue) => issue.path === 'root' && /missing/.test(issue.message)));
  assert.ok(issues.some((issue) => issue.path === 'bones[3].parent' && /unknown parent/.test(issue.message)));
  assert.ok(issues.some((issue) => /Circular hierarchy/.test(issue.message)));
  assert.throws(() => parseRigDefinition(broken), RigValidationError);
});

test('rig validation checks scalars and JSON compatibility', () => {
  const broken = structuredClone(rigFile) as unknown as { bones: Record<string, unknown>[] };
  broken.bones[0]!.x = Infinity;
  broken.bones[0]!.length = -2;
  broken.bones[1]!.sprite = { texture: 'body', originX: 2 };
  const issues = validateRigDefinition(broken);
  assert.ok(issues.some((issue) => issue.path === 'bones[0].x'));
  assert.ok(issues.some((issue) => issue.path === 'bones[0].length'));
  assert.ok(issues.some((issue) => issue.path === 'bones[1].sprite.originX'));
  const cyclic: Record<string, unknown> = { ...rigFile };
  cyclic.self = cyclic;
  assert.ok(validateRigDefinition(cyclic).some((issue) => /Cyclic/.test(issue.message)));
  assert.ok(
    validateRigDefinition({ ...rigFile, extra: new Map() }).some((issue) => /plain JSON object/.test(issue.message)),
  );
  assert.ok(validateRigDefinition({ ...rigFile, extra: () => 1 }).some((issue) => /JSON value/.test(issue.message)));
  assert.ok(
    validateRigDefinition({ ...rigFile, bones: [{ id: 'root', rotaton: 1 }] }).some(
      (issue) => issue.path === 'bones[0].rotaton' && /Unknown field/.test(issue.message),
    ),
  );
});

test('rig files require a supported version', () => {
  assert.ok(validateRigDefinition({ ...rigFile, version: undefined }).some((issue) => issue.path === 'version'));
  assert.throws(() => parseRigDefinition({ ...rigFile, version: 2 }), UnsupportedFormatVersionError);
});

test('animation round trips through JSON and behaves like an authored TypeScript clip', () => {
  const rig = parseRigDefinition(JSON.parse(JSON.stringify(rigFile)));
  const parsed = parseAnimationClip(JSON.parse(JSON.stringify(clipFile)), rig);
  const authored: AnimationClip = {
    name: clipFile.name,
    duration: clipFile.duration,
    loop: clipFile.loop,
    playback: { mode: 'stepped', fps: 10 },
    tracks: clipFile.tracks,
    events: [{ time: 250, name: 'step', data: { side: 'left', count: 1 } }],
  };
  const makePlayer = (clip: AnimationClip) => {
    const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
    const player = new AnimationPlayer(rig, joints);
    const events: string[] = [];
    player.onAnimationEvent(({ name }) => events.push(name));
    player.addAnimation(clip);
    player.play('move');
    return { player, joints, events };
  };
  const external = makePlayer(parsed);
  const typescript = makePlayer(authored);
  for (const delta of [50, 50, 150, 750, 300]) {
    external.player.update(delta);
    typescript.player.update(delta);
    assert.deepEqual(external.joints.get('arm')?.pose, typescript.joints.get('arm')?.pose);
    assert.deepEqual(external.events, typescript.events);
  }
  assert.deepEqual(validateAnimationDefinition(clipFile, rig), []);
});

test('animation validation reports unknown bones, timeline errors and invalid FPS', () => {
  const rig = new Rig(rigFile);
  const broken = {
    ...clipFile,
    tracks: {
      ghost: [{ time: 0, x: 1 }],
      arm: [
        { time: 500, x: 1 },
        { time: 200, x: 2 },
        { time: 1200, x: 3 },
      ],
    },
    events: [{ time: -1, name: 'early' }],
  };
  const issues = validateAnimationDefinition(broken, rig);
  assert.ok(issues.some((issue) => issue.path === 'tracks.ghost' && /unknown bone/.test(issue.message)));
  assert.ok(issues.some((issue) => issue.path === 'tracks.arm[1].time'));
  assert.ok(issues.some((issue) => issue.path === 'tracks.arm[2].time'));
  assert.ok(issues.some((issue) => issue.path === 'events[0].time'));
  assert.throws(() => parseAnimationClip(broken, rig), AnimationValidationError);
  assert.ok(validateAnimationDefinition({ ...clipFile, duration: 0 }, rig).some((issue) => issue.path === 'duration'));
  assert.ok(validateAnimationDefinition({ ...clipFile, name: '' }, rig).some((issue) => issue.path === 'name'));
  assert.ok(
    validateAnimationDefinition({ ...clipFile, playback: { mode: 'stepped', fps: 0 } }, rig).some(
      (issue) => issue.path === 'playback.fps',
    ),
  );
  assert.throws(() => parseAnimationClip({ ...clipFile, version: 2 }, rig), UnsupportedFormatVersionError);
  assert.ok(
    validateAnimationDefinition(
      { ...clipFile, events: [{ time: 0, name: 'bad', data: { callback: () => 1 } }] },
      rig,
    ).some((issue) => issue.path === 'events[0].data.callback'),
  );
});
