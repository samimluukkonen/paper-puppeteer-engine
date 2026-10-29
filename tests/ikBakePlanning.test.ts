import { assert, test } from 'vitest';
import { bakeRigSnapshot, planIKBake } from '../src/devtools/animation-editor/ikBakePlanning.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { commitIKBake } from '../src/engine/ik/IKBakeCommit.js';
import { generateBakedBoneKeys } from '../src/engine/ik/IKBakeGeneration.js';
import { sampleIKBake } from '../src/engine/ik/IKBakeSampling.js';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { Rig } from '../src/engine/Rig.js';
import type { RigDefinition } from '../src/engine/types.js';

test('transferred logical joints preserve explicit-length normalization and exact engine verification', () => {
  const rig = new Rig({
    root: 'body',
    bones: [
      { id: 'body', rotation: 0.2, scaleX: -1, scaleY: 1 },
      { id: 'upper', parent: 'body', length: 53.19 },
      { id: 'lower', parent: 'upper', x: 2, y: 3, length: 47.71 },
      { id: 'hand', parent: 'lower', x: -1, y: 2 },
    ],
    ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', endOffset: { x: 2, y: 3 } }],
  });
  const animation = {
    name: 'reach',
    duration: 1000,
    loop: false,
    tracks: {},
    ikTracks: { arm: [{ time: 0, x: 60, y: 20 }] },
    events: [{ time: 0, name: 'data', data: { text: 'é😀' } }],
  };
  const original = JSON.stringify(rig.bones);
  const plan = generateBakedBoneKeys(sampleIKBake(animation, rig, ['arm']), rig, { animation, outputMode: 'smooth' });
  assert.isTrue(plan.success);
  const result = planIKBake(structuredClone({ rig: bakeRigSnapshot(rig), animation, constraintIds: ['arm'], fps: 10 }));
  assert.isTrue(result.success);
  if (!result.success) throw new Error('Planning failed');
  assert.deepEqual(result.plan, plan);
  assert.deepEqual({ ...result, plan: undefined }, { ...commitIKBake(animation, result.plan, rig), plan: undefined });
  assert.equal(JSON.stringify(rig.bones), original);
});

test('worker planning preserves mesh corrections and validates topology with explicit-length joints', () => {
  const base: RigDefinition = {
    root: 'body',
    bones: [
      { id: 'body' },
      { id: 'upper', parent: 'body', length: 53.19 },
      { id: 'lower', parent: 'upper', x: 2, y: 3, length: 47.71 },
      { id: 'hand', parent: 'lower', x: -1, y: 2 },
    ],
    slots: [{ id: 'sleeve', bone: 'upper', x: 3, rotation: 0.2 }],
    ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' }],
  };
  const mesh = createRectangleMeshAttachment({ id: 'mesh', texture: 'paper' }, { width: 20, height: 10 }, base);
  const rig = new Rig({ ...base, attachments: [mesh] });
  const animation: AnimationClip = {
    name: 'reach',
    duration: 1000,
    loop: false,
    tracks: {},
    ikTracks: { arm: [{ time: 0, x: 60, y: 20 }] },
    deformationTracks: {
      mesh: [
        { time: 0, offsets: {} },
        { time: 1000, offsets: { 'top-left': { x: 1, y: 2 } } },
      ],
    },
    events: [{ time: 500, name: 'retained' }],
  };
  const before = structuredClone(animation);
  const request = structuredClone({ rig: bakeRigSnapshot(rig), animation, constraintIds: ['arm'], fps: 10 });
  const result = planIKBake(request);
  assert.isTrue(result.success, result.issues.map((issue) => issue.message).join('\n'));
  if (!result.success) throw new Error('Planning failed');
  assert.deepEqual(result.animation.deformationTracks, animation.deformationTracks);
  assert.deepEqual(result.animation.events, animation.events);
  assert.deepEqual(result.animation.disabledIKConstraints, ['arm']);
  const { plan, ...committed } = result;
  assert.deepEqual(commitIKBake(animation, plan, rig), committed);
  assert.deepEqual(animation, before);
  const invalid = planIKBake({
    ...request,
    animation: {
      ...request.animation,
      deformationTracks: { mesh: [{ time: 0, offsets: { missing: { x: 1, y: 2 } } }] },
    },
  });
  assert.isFalse(invalid.success);
  assert.include(invalid.issues.map((issue) => issue.message).join(' '), 'missing');
});
