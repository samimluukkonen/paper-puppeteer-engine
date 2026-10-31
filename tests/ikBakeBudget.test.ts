import { afterEach, assert, test, vi } from 'vitest';
import { planIKBake } from '../src/devtools/animation-editor/ikBakePlanning.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { generateBakedBoneKeys } from '../src/engine/ik/IKBakeGeneration.js';
import { sampleIKBake } from '../src/engine/ik/IKBakeSampling.js';
import { IsolatedIKSampler } from '../src/engine/ik/IsolatedIKSampler.js';
import { Rig } from '../src/engine/Rig.js';
import type { RigDefinition } from '../src/engine/types.js';

afterEach(() => vi.restoreAllMocks());

const animation: AnimationClip = { name: 'reach', duration: 1000, loop: false, tracks: {} };

function definition(bones = 3, constraints = 1): RigDefinition {
  return {
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'middle', parent: 'root', y: 10 },
      { id: 'end', parent: 'middle', y: 10 },
      ...Array.from({ length: bones - 3 }, (_, index) => ({ id: `extra${index}`, parent: 'root' })),
    ],
    ik: Array.from({ length: constraints }, (_, index) => ({
      name: `chain${index}`,
      rootBone: 'root',
      middleBone: 'middle',
      endBone: 'end',
      enabled: index === 0,
    })),
  };
}

test.each([
  { bones: 1000, constraints: 1, fps: 2000, message: 'bone/constraint work' },
  { bones: 3, constraints: 100, fps: 300, message: 'bone/constraint work' },
  { bones: 3, constraints: 1, fps: 50_000, message: 'generated keys' },
  { bones: 3, constraints: 1, fps: 35_000, message: 'estimated bake memory' },
])('preflight rejects $message before evaluation ($bones bones, $constraints constraints)', (entry) => {
  const rigDefinition = definition(entry.bones, entry.constraints);
  const rig = new Rig(rigDefinition);
  const sample = vi.spyOn(IsolatedIKSampler.prototype, 'sample');
  const before = JSON.stringify({ animation, rigDefinition });
  const result = sampleIKBake(animation, rig, ['chain0'], { fps: entry.fps });
  assert.isFalse(result.success);
  assert.deepEqual(result.samples, []);
  assert.equal(result.issues[0]!.code, 'invalid-sampling');
  assert.include(result.issues[0]!.message, entry.message);
  assert.include(result.issues[0]!.message, 'Lower the sampling FPS');
  assert.equal(sample.mock.calls.length, 0);
  const planned = planIKBake({ rig: rigDefinition, animation, constraintIds: ['chain0'], fps: entry.fps });
  assert.isFalse(planned.success);
  assert.include(planned.issues[0]!.message, entry.message);
  assert.equal(sample.mock.calls.length, 0);
  assert.equal(JSON.stringify({ animation, rigDefinition }), before);
});

test('ordinary requests retain complete samples, generated keys and exact endpoints', () => {
  const rig = new Rig(definition());
  const sampled = sampleIKBake(animation, rig, ['chain0'], { fps: 24 });
  assert.isTrue(sampled.success);
  if (!sampled.success) throw new Error('Sampling failed');
  assert.lengthOf(sampled.samples, 25);
  assert.equal(sampled.samples[0]!.time, 0);
  assert.equal(sampled.samples.at(-1)!.time, 1000);
  const plan = generateBakedBoneKeys(sampled, rig, { animation });
  assert.isTrue(plan.success);
  if (!plan.success) throw new Error('Generation failed');
  assert.equal(plan.generatedKeyCount, 50);
});

test('generation independently rejects oversized caller-assembled samples before emitting keys', () => {
  const rig = new Rig(definition());
  const sampled = sampleIKBake(animation, rig, ['chain0']);
  if (!sampled.success) throw new Error('Sampling failed');
  const plan = generateBakedBoneKeys({ ...sampled, samples: Array(50_001).fill(sampled.samples[0]) }, rig, {
    animation,
  });
  assert.isFalse(plan.success);
  assert.include(plan.issues[0]!.message, 'generated keys');
  assert.notProperty(plan, 'generatedAnimation');
});
