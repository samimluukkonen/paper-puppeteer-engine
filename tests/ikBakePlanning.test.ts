import { assert, test } from 'vitest';
import { bakeRigSnapshot, planIKBake } from '../src/devtools/animation-editor/ikBakePlanning.js';
import { commitIKBake } from '../src/engine/ik/IKBakeCommit.js';
import { generateBakedBoneKeys } from '../src/engine/ik/IKBakeGeneration.js';
import { sampleIKBake } from '../src/engine/ik/IKBakeSampling.js';
import { Rig } from '../src/engine/Rig.js';

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
