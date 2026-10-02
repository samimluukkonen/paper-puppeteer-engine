import { assert, test } from 'vitest';
import { type AnimationClip, compileClip } from '../src/engine/AnimationClip.js';
import {
  inspectAnimationDefinition,
  inspectRigDefinition,
  validateAnimationDefinition,
  validateRigDefinition,
} from '../src/engine/externalData.js';
import { generateJsonSchemas } from '../src/engine/jsonSchemas.js';
import { Rig } from '../src/engine/Rig.js';
import type { RigDefinition } from '../src/engine/types.js';

const rigDefinition: RigDefinition = {
  root: 'root',
  bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }],
  slots: [{ id: 'hand', bone: 'arm' }],
  attachments: [{ id: 'open', texture: 'hand' }],
  skins: [{ version: 1, name: 'default', slots: { hand: 'open' } }],
};

test.each<[string, Partial<RigDefinition>, string]>([
  ['missing root', { root: 'missing' }, 'root'],
  ['duplicate bone', { bones: [{ id: 'root' }, { id: 'root' }] }, 'bones[1].id'],
  ['root parent', { bones: [{ id: 'root', parent: 'root' }] }, 'bones[0].parent'],
  ['missing parent', { bones: [{ id: 'root' }, { id: 'arm' }] }, 'bones[1].parent'],
  ['unknown parent', { bones: [{ id: 'root' }, { id: 'arm', parent: 'missing' }] }, 'bones[1].parent'],
  [
    'cycle',
    { bones: [{ id: 'root' }, { id: 'arm', parent: 'hand' }, { id: 'hand', parent: 'arm' }] },
    'bones[2].parent',
  ],
  [
    'duplicate slot',
    {
      slots: [
        { id: 'hand', bone: 'arm' },
        { id: 'hand', bone: 'arm' },
      ],
    },
    'slots[1].id',
  ],
  ['unknown slot bone', { slots: [{ id: 'hand', bone: 'missing' }] }, 'slots[0].bone'],
  [
    'duplicate attachment',
    {
      attachments: [
        { id: 'open', texture: 'hand' },
        { id: 'open', texture: 'hand' },
      ],
    },
    'attachments[1].id',
  ],
  [
    'duplicate skin',
    {
      skins: [
        { version: 1, name: 'default', slots: {} },
        { version: 1, name: 'default', slots: {} },
      ],
    },
    'skins[1].name',
  ],
  [
    'unknown skin slot',
    { skins: [{ version: 1, name: 'default', slots: { missing: null } }] },
    'skins[0].slots.missing',
  ],
  [
    'unknown skin attachment',
    { skins: [{ version: 1, name: 'default', slots: { hand: 'missing' } }] },
    'skins[0].slots.hand',
  ],
])('runtime and file rig validation reject %s', (_name, patch, path) => {
  const definition = { ...rigDefinition, ...patch };
  assert.throws(() => new Rig(definition));
  assert.ok(validateRigDefinition({ version: 1, ...definition }).some((issue) => issue.path === path));
});

const rig = new Rig(rigDefinition);
const clip: AnimationClip = {
  name: 'move',
  duration: 100,
  loop: false,
  tracks: {
    arm: [
      { time: 0, x: 0 },
      { time: 100, x: 10 },
    ],
  },
  events: [
    { time: 0, name: 'start' },
    { time: 100, name: 'end' },
  ],
};

test.each<[string, Partial<AnimationClip>, string]>([
  ['unknown bone', { tracks: { missing: [] } }, 'tracks.missing'],
  ['negative key time', { tracks: { arm: [{ time: -1 }] } }, 'tracks.arm[0].time'],
  ['late key time', { tracks: { arm: [{ time: 101 }] } }, 'tracks.arm[0].time'],
  ['repeated key time', { tracks: { arm: [{ time: 0 }, { time: 0 }] } }, 'tracks.arm[1].time'],
  ['decreasing key time', { tracks: { arm: [{ time: 100 }, { time: 0 }] } }, 'tracks.arm[1].time'],
  ['negative event time', { events: [{ time: -1, name: 'early' }] }, 'events[0].time'],
  ['late event time', { events: [{ time: 101, name: 'late' }] }, 'events[0].time'],
])('runtime and file animation validation reject %s', (_name, patch, path) => {
  const definition = { ...clip, ...patch };
  assert.throws(() => compileClip(definition, rig));
  assert.ok(validateAnimationDefinition({ version: 1, ...definition }, rig).some((issue) => issue.path === path));
});

test('runtime and file validation accept timeline endpoints, empty tracks and null skin attachments', () => {
  const definition = { ...rigDefinition, skins: [{ version: 1 as const, name: 'empty', slots: { hand: null } }] };
  assert.deepEqual(validateRigDefinition({ version: 1, ...definition }), []);
  new Rig(definition);
  const animation = { ...clip, tracks: { ...clip.tracks, root: [] } };
  assert.deepEqual(validateAnimationDefinition({ version: 1, ...animation }, rig), []);
  assert.equal(compileClip(animation, rig).events.length, 2);
});

test('file validation derives nested allowed fields while retaining reference diagnostics', () => {
  const issues = validateRigDefinition({
    version: 1,
    ...rigDefinition,
    extra: true,
    bones: [{ id: 'root', extra: true, sprite: { texture: 'body', extra: true } }],
    slots: [{ id: 'hand', bone: 'missing', extra: true }],
    attachments: [{ id: 'open', texture: 'hand', extra: true }],
    skins: [{ version: 1, name: 'default', slots: {}, extra: true }],
  });
  assert.sameMembers(
    issues.filter((issue) => /Unknown field/.test(issue.message)).map((issue) => issue.path),
    ['extra', 'bones[0].extra', 'bones[0].sprite.extra', 'slots[0].extra', 'attachments[0].extra', 'skins[0].extra'],
  );
  assert.ok(issues.some((issue) => issue.path === 'slots[0].bone'));

  const animationIssues = validateAnimationDefinition(
    {
      version: 1,
      ...clip,
      extra: true,
      tracks: { arm: [{ time: 0, extra: true }] },
      events: [{ time: 0, name: 'start', extra: true, data: { arbitraryPayloadField: true } }],
      playback: { mode: 'smooth', fps: 10 },
    },
    rig,
  );
  assert.sameMembers(
    animationIssues.map((issue) => issue.path),
    ['extra', 'playback.fps', 'tracks.arm[0].extra', 'events[0].extra'],
  );
});

const committedSchemas = import.meta.glob('../schemas/*.schema.json', { eager: true, import: 'default' });

test('strict-file inspection retains unknown-field diagnostics alongside malformed scalars', () => {
  const rigIssues = validateRigDefinition({
    version: 1,
    ...rigDefinition,
    bones: [{ id: 'root', x: 'bad', typo: 2, sprite: { texture: 'body', typo: 3 } }],
  });
  assert.sameMembers(
    rigIssues.map((issue) => issue.path),
    ['bones[0].x', 'bones[0].typo', 'bones[0].sprite.typo'],
  );
  const animationIssues = validateAnimationDefinition(
    {
      version: 1,
      ...clip,
      tracks: { arm: [{ time: 0, x: 'bad', typo: 2 }] },
      playback: { mode: 'stepped', fps: 0, typo: 3 },
    },
    rig,
  );
  assert.sameMembers(
    animationIssues.map((issue) => issue.path),
    ['tracks.arm[0].x', 'tracks.arm[0].typo', 'playback.fps', 'playback.typo'],
  );
});

test('strict-file inspection strips file metadata and keeps runtime timeline diagnostics', () => {
  assert.deepEqual(inspectRigDefinition({ version: 1, name: 'sample', ...rigDefinition }).data, rigDefinition);
  assert.deepEqual(inspectAnimationDefinition({ version: 1, ...clip }, rig).data, clip);
  const issues = validateAnimationDefinition({ version: 1, ...clip, tracks: { arm: [{ time: -1 }] } }, rig);
  assert.deepEqual(issues, [
    {
      severity: 'error',
      path: 'tracks.arm[0].time',
      message: 'Keyframe time must increase strictly and stay within the animation duration.',
    },
  ]);
});

test('committed editor JSON schemas match the Zod file definitions', () => {
  for (const [filename, schema] of Object.entries(generateJsonSchemas())) {
    const committed = committedSchemas[`../schemas/${filename}`];
    assert.deepEqual(committed, schema, `Run npm run schemas:generate to update ${filename}.`);
  }
});
