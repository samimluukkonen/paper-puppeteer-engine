import { assert, test, vi } from 'vitest';
import { AnimationStateController, Puppet } from '../src/engine/runtime.js';
import { controllerAnimations } from './helpers/consumerCharacter.js';
import { demoCharacter } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

// CPU-only diagnostics: actual Puppet/IK/projection with a minimal scene, excluding DOM and GPU.
// VITE_PROFILE=1 npx vitest run tests/runtimeController.profile.test.ts --reporter=verbose
for (const count of [1, 20]) {
  for (const workload of ['playback', 'states', 'queue', 'crossfade', 'ik', 'async'] as const) {
    test.skipIf(import.meta.env.VITE_PROFILE !== '1')(
      `${count} Puppet(s), ${workload}`,
      { timeout: 30000 },
      async () => {
        const puppets = Array.from(
          { length: count },
          () =>
            new Puppet(puppetScene(), {
              definition: demoCharacter,
              animations: [...demoCharacter.animations, ...controllerAnimations],
              autoUpdate: false,
            }),
        );
        const controllers = puppets.map(
          (puppet) =>
            new AnimationStateController(puppet, {
              initialState: 'idle',
              defaultFadeDuration: 150,
              states: { idle: { animation: 'idle' }, walking: { animation: 'walk' } },
            }),
        );
        for (const puppet of puppets)
          if (workload === 'ik') {
            puppet.getIK('rightArmIK').setTarget(-80, -40);
            puppet.getIK('rightLegIK').setTarget(-20, 140);
          }
        let frame = 0;
        const step = async () => {
          for (let index = 0; index < puppets.length; index++) {
            const puppet = puppets[index]!;
            if (workload === 'states') controllers[index]!.setState(frame % 2 ? 'walking' : 'idle');
            if (workload === 'crossfade' && frame % 10 === 0)
              puppet.play(frame % 20 ? 'idle' : 'walk', { fadeDuration: 150 });
            if (workload === 'queue' && (!puppet.animationPlayer.isPlaying || frame === 0))
              puppet.replaceQueue([{ name: 'attack' }, { name: 'recover', options: { fadeDuration: 100 } }]);
            if (workload === 'async') {
              const result = puppet.playAndWait('attack', { fadeDuration: 150 });
              puppet.update(400);
              assert.equal((await result).status, 'completed');
            } else puppet.update(16);
          }
          frame++;
        };
        try {
          for (let index = 0; index < 100; index++) await step();
          const samples: number[] = [];
          for (let batch = 0; batch < 7; batch++) {
            const start = performance.now();
            for (let index = 0; index < 300; index++) await step();
            samples.push((performance.now() - start) / 300);
          }
          samples.sort((a, b) => a - b);
          console.log(
            `${count} Puppet(s), ${workload}: ${samples[3]!.toFixed(4)} ms/batch; ${((samples[3]! * 1000) / count).toFixed(2)} us/Puppet`,
          );
        } finally {
          for (const controller of controllers) controller.dispose();
          for (const puppet of puppets) puppet.destroy();
        }
      },
    );
  }
}
