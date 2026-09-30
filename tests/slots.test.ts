import { assert, test } from 'vitest';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { parseRigDefinition, RigValidationError, validateRigDefinition } from '../src/engine/externalData.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import { SlotState } from '../src/engine/SlotState.js';
import type { RigDefinition } from '../src/engine/types.js';

const definition: RigDefinition = {
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'arm', parent: 'root', x: 10, length: 20, depth: -1 },
    { id: 'hand', parent: 'arm', y: 20, depth: 1 },
  ],
  slots: [
    { id: 'handVisual', bone: 'hand', x: 2, rotation: 0.1, scaleX: 1.2, depth: 20 },
    { id: 'headwear', bone: 'root', depth: 30 },
    { id: 'weapon', bone: 'hand', depth: 40 },
  ],
  attachments: [
    { id: 'open', texture: 'hand', originX: 0.3, frame: 'idle' },
    { id: 'grip', texture: 'grip', rotation: 0.2 },
    { id: 'helmet', texture: 'helmet' },
    { id: 'katana', texture: 'katana', x: 4, y: 2 },
  ],
  skins: [
    { version: 1, name: 'default', slots: { handVisual: 'open' } },
    { version: 1, name: 'armored', slots: { handVisual: 'grip', headwear: 'helmet' } },
    { version: 1, name: 'helmet-only', slots: { headwear: 'helmet' } },
    { version: 1, name: 'remove-helmet', slots: { headwear: null } },
  ],
};

test('slot and skin data round trips through versioned JSON', () => {
  const rig = parseRigDefinition(JSON.parse(JSON.stringify({ version: 1, ...definition })));
  assert.deepEqual(validateRigDefinition({ version: 1, ...definition }), []);
  assert.equal(rig.slots[0]?.depth, 20);
  assert.equal(rig.attachments[0]?.frame, 'idle');
  assert.equal(rig.skins[2]?.slots.headwear, 'helmet');
  assert.ok(Object.isFrozen(rig.slots));
  assert.ok(Object.isFrozen(rig.skins[0]?.slots));
});

test('validation finds slot, attachment, and skin references and versions', () => {
  const broken = {
    version: 1,
    ...definition,
    slots: [...definition.slots!, { id: 'weapon', bone: 'missing' }],
    attachments: [...definition.attachments!, { id: 'katana', texture: 'duplicate' }],
    skins: [...definition.skins!, { version: 1, name: 'bad', slots: { missing: 'ghost' } }],
  };
  const issues = validateRigDefinition(broken);
  assert.ok(issues.some((issue) => issue.path === 'slots[3].id' && /Duplicate/.test(issue.message)));
  assert.ok(issues.some((issue) => issue.path === 'slots[3].bone' && /unknown bone/.test(issue.message)));
  assert.ok(issues.some((issue) => issue.path === 'attachments[4].id' && /Duplicate/.test(issue.message)));
  assert.ok(issues.some((issue) => issue.path === 'skins[4].slots.missing'));
  assert.ok(
    validateRigDefinition({ ...broken, skins: [{ version: 2, name: 'bad', slots: {} }] }).some(
      (issue) => issue.path === 'skins[0].version',
    ),
  );
  assert.throws(() => parseRigDefinition(broken), RigValidationError);
  const references = validateRigDefinition({
    version: 1,
    ...definition,
    skins: [{ version: 1, name: 'bad', slots: { missing: 'ghost', weapon: 'ghost' } }],
  });
  assert.ok(references.some((issue) => issue.path === 'skins[0].slots.missing' && /Unknown slot/.test(issue.message)));
  assert.ok(
    references.some((issue) => issue.path === 'skins[0].slots.weapon' && /Unknown attachment/.test(issue.message)),
  );
  assert.throws(() => new Rig({ ...definition, slots: [{ id: 'bad', bone: 'missing' }] }), /unknown bone/);
});

test('attachment assignment, clearing, skins, and partial overrides stay independent', () => {
  const state = new SlotState(new Rig(definition));
  state.setSkin('default');
  assert.equal(state.getAttachment('handVisual'), 'open');
  state.setAttachment('handVisual', 'grip');
  state.setAttachment('weapon', 'katana');
  assert.equal(state.getAttachment('weapon'), 'katana');
  state.clearAttachment('weapon');
  assert.equal(state.getAttachment('weapon'), undefined);
  state.applySkin('helmet-only');
  assert.equal(state.getAttachment('handVisual'), 'grip');
  assert.equal(state.getAttachment('headwear'), 'helmet');
  state.applySkin('remove-helmet');
  assert.equal(state.getAttachment('headwear'), undefined);
  state.setSkin('armored');
  assert.equal(state.getAttachment('handVisual'), 'grip');
  assert.equal(state.getAttachment('headwear'), 'helmet');
  state.setSkin('default');
  assert.equal(state.getAttachment('headwear'), undefined);
  assert.throws(() => state.setAttachment('bad', 'grip'), /Unknown slot/);
  assert.throws(() => state.setAttachment('weapon', 'bad'), /Unknown attachment/);
  assert.throws(() => state.setSkin('bad'), /Unknown skin/);
});

test('skin and sprite swaps retain bone geometry, draw order, animation, and IK references', () => {
  const rig = new Rig(definition);
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const player = new AnimationPlayer(rig, joints);
  player.addAnimation({
    name: 'move',
    duration: 100,
    loop: true,
    tracks: {
      arm: [
        { time: 0, rotation: 0 },
        { time: 100, rotation: 1 },
      ],
    },
  });
  const ik = new TwoBoneIKConstraint(
    { name: 'reach', rootBone: 'root', middleBone: 'arm', endBone: 'hand' },
    rig,
    joints,
  );
  const state = new SlotState(rig);
  const bonesBefore = JSON.stringify(rig.bones);
  const orderBefore = [...rig.renderOrder];
  const refsBefore = [ik.rootBone, ik.middleBone, ik.endBone];
  state.setSkin('default');
  state.setAttachment('handVisual', 'grip');
  state.setAttachment('weapon', 'katana');
  state.applySkin('helmet-only');
  state.setSkin('armored');
  player.play('move');
  player.update(50);
  assert.equal(joints.get('arm')?.pose.rotation, 0.5);
  assert.equal(JSON.stringify(rig.bones), bonesBefore);
  assert.deepEqual(rig.renderOrder, orderBefore);
  assert.deepEqual([ik.rootBone, ik.middleBone, ik.endBone], refsBefore);
  assert.equal(joints.get('hand')?.pose.y, 20);
});
