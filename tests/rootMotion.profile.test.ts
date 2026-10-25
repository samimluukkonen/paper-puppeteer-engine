import { test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { Actor } from '../src/engine/Actor.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { demoCharacter } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function clip(keys: number): AnimationClip {
  return {
    ...demoCharacter.animations.find((clip) => clip.name === 'walk')!,
    name: 'profile',
    duration: 1000,
    loop: true,
    ...(keys
      ? {
          rootMotion: {
            translationKeys: Array.from({ length: keys }, (_, index) => ({
              time: (index * 1000) / (keys - 1),
              x: (index * 80) / (keys - 1),
              y: 0,
            })),
          },
        }
      : {}),
  };
}
function measure(label: string, step: () => void, iterations = 300) {
  for (let index = 0; index < Math.min(100, iterations); index++) step();
  const samples: number[] = [];
  for (let batch = 0; batch < 7; batch++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) step();
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a, b) => a - b);
  console.log(`${label}: ${samples[3]!.toFixed(4)} ms/operation (median of 7 x ${iterations}; CPU only)`);
}
// Optional local diagnostic; no timing thresholds or CI scheduling. One worker, run apart from browser checks.
for (const [count, keys] of [
  [1, 0],
  [1, 2],
  [1, 1001],
  [20, 2],
] as const) {
  test.skipIf(import.meta.env.VITE_PROFILE !== '1')(`${count} puppet(s), ${keys} root keys, looping playback`, () => {
    const createPuppet = () =>
      new Puppet(puppetScene(), {
        definition: demoCharacter,
        animations: [clip(keys)],
        autoUpdate: false,
      });
    const puppets = count === 20 ? [] : Array.from({ length: count }, createPuppet);
    // Include the actual declarative choreography clock/ownership path for the many-Actor workload.
    const runner =
      count === 20
        ? new SceneRunner(
            {
              ...createEmptyScene({ id: 'profile', duration: 1_000_000 }),
              actors: Array.from({ length: count }, (_, index) => ({
                id: String(index),
                character: { manifest: 'character.json' },
                position: { x: index * 100, y: 0 },
              })),
              actions: Array.from({ length: count }, (_, index) => ({
                id: `clip-${index}`,
                actorId: String(index),
                type: 'animation',
                time: 0,
                duration: 1_000_000,
                animation: 'profile',
                speed: 1,
                loop: true,
                movementSource: 'rootMotion',
              })),
            },
            {
              createActor: (definition) =>
                new Actor({ id: definition.id, puppet: createPuppet(), puppetOwnership: 'owned' }),
            },
          )
        : undefined;
    try {
      if (runner) runner.play();
      else for (const puppet of puppets) puppet.play('profile', { rootMotion: keys ? 'apply' : 'ignore' });
      measure(`${count} ${runner ? 'scene Actor(s)' : 'puppet(s)'}, ${keys} root keys, looping playback`, () => {
        if (runner) runner.update(16);
        else for (const puppet of puppets) puppet.update(16);
      });
    } finally {
      runner?.dispose();
      for (const puppet of puppets) puppet.destroy();
    }
  });
}
for (const workload of ['scrub', 'graph'] as const) {
  test.skipIf(import.meta.env.VITE_PROFILE !== '1')(`1001 root keys, editor ${workload}`, { timeout: 30000 }, () => {
    const state = new AnimationEditorState(demoCharacter.rig, [clip(1001)]);
    state.selectAnimation('profile');
    const puppet = new Puppet(puppetScene(), { definition: demoCharacter, autoUpdate: false });
    const preview = new AnimationEditorPreview(state, puppet);
    let index = 0;
    try {
      measure(
        `1001 root keys, editor ${workload}`,
        () => {
          if (workload === 'scrub') state.setCurrentTime(((index++ * 137) % 1000) / 1000);
          else {
            state.beginGraphEdit({ channel: { kind: 'root', id: 'Root Motion', property: 'x' }, time: 0.5 });
            state.previewGraphEdit({ value: 41 + (index++ % 2) });
            state.commitGraphEdit();
            state.undo();
          }
        },
        workload === 'graph' ? 30 : 300,
      );
    } finally {
      preview.dispose();
      puppet.destroy();
    }
  });
}
