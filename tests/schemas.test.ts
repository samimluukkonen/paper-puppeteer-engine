import { assert, test } from 'vitest';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import type { TwoBoneIKDefinition } from '../src/engine/ik/types.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import {
  animationClipSchema,
  characterManifestSchema,
  poseDefinitionSchema,
  rigDefinitionSchema,
  skinDefinitionSchema,
  twoBoneIKDefinitionSchema,
} from '../src/engine/schemas.js';
import type { RigDefinition } from '../src/engine/types.js';

test('identifier dictionaries reject reserved keys before record parsing drops them', () => {
  const dictionary = JSON.parse('{"__proto__":null}');
  for (const [schema, input] of [
    [skinDefinitionSchema, { version: 1, name: 'default', slots: dictionary }],
    [animationClipSchema, { name: 'idle', duration: 100, loop: true, tracks: dictionary }],
    [poseDefinitionSchema, { version: 1, name: 'rest', bones: dictionary }],
    [
      characterManifestSchema,
      {
        version: 1,
        id: 'test',
        rig: 'rig.json',
        defaultSkin: 'default',
        skins: dictionary,
        animations: [],
        textures: {},
      },
    ],
    [
      characterManifestSchema,
      {
        version: 1,
        id: 'test',
        rig: 'rig.json',
        defaultSkin: 'default',
        skins: {},
        animations: [],
        textures: dictionary,
      },
    ],
  ] as const) {
    const parsed = schema.safeParse(input);
    assert.isFalse(parsed.success);
    if (!parsed.success) assert.ok(parsed.error.issues.some((issue) => /reserved/.test(issue.message)));
  }
});

test('schemas parse plain rig and animation data with useful nested error paths', () => {
  const rig = rigDefinitionSchema.parse({ root: 'root', bones: [{ id: 'root', sprite: { texture: 'body' } }] });
  assert.strictEqual(rig.bones[0]?.sprite?.texture, 'body');
  const clip = animationClipSchema.parse({
    name: 'idle',
    duration: 100,
    loop: true,
    tracks: { root: [{ time: 0, rotation: 0 }] },
  });
  assert.strictEqual(clip.tracks.root?.[0]?.rotation, 0);
  const parsedRig = new Rig(rig);
  const joints = new Map(parsedRig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  new AnimationPlayer(parsedRig, joints).addAnimation(clip);

  const badRig = rigDefinitionSchema.safeParse({
    root: 'root',
    bones: [{ id: 'root', sprite: { texture: 'body', originY: 2 } }],
  });
  assert.strictEqual(badRig.success, false);
  if (!badRig.success) assert.deepEqual(badRig.error.issues[0]?.path, ['bones', 0, 'sprite', 'originY']);

  const badClip = animationClipSchema.safeParse({
    name: 'bad',
    duration: 100,
    loop: true,
    tracks: { root: [{ time: 0, x: 'far' }] },
  });
  assert.strictEqual(badClip.success, false);
  if (!badClip.success) assert.deepEqual(badClip.error.issues[0]?.path, ['tracks', 'root', 0, 'x']);

  const badIK = twoBoneIKDefinitionSchema.safeParse({
    name: 'arm',
    rootBone: 'root',
    middleBone: 'elbow',
    endBone: 'hand',
    endOffset: { x: 0, y: Infinity },
  });
  assert.strictEqual(badIK.success, false);
  if (!badIK.success) assert.deepEqual(badIK.error.issues[0]?.path, ['endOffset', 'y']);
});

test('engine entry points reject malformed runtime input before building state', () => {
  assert.throws(
    () => new Rig({ root: 'root', bones: [{ id: 'root', sprite: { texture: 42 } }] } as unknown as RigDefinition),
    /texture/,
  );
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const player = new AnimationPlayer(rig, joints);
  assert.throws(
    () => player.addAnimation({ name: 'bad', duration: 100, loop: 'yes', tracks: {} } as unknown as AnimationClip),
    /loop/,
  );
  assert.strictEqual(player.currentAnimation, undefined);

  const chainRig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'elbow', parent: 'root' }, { id: 'hand', parent: 'elbow' }],
  });
  const chainJoints = new Map(chainRig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const definition = twoBoneIKDefinitionSchema.parse({
    name: 'arm',
    rootBone: 'root',
    middleBone: 'elbow',
    endBone: 'hand',
  });
  assert.strictEqual(new TwoBoneIKConstraint(definition, chainRig, chainJoints).name, 'arm');
  assert.throws(
    () =>
      new TwoBoneIKConstraint(
        { ...definition, enabled: 'yes' } as unknown as TwoBoneIKDefinition,
        chainRig,
        chainJoints,
      ),
    /enabled/,
  );
});
