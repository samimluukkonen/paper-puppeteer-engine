import { assert, test, vi } from 'vitest';
import { Actor, Puppet } from '../src/engine/runtime.js';
import { demoCharacter } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

// CPU diagnostics only: real animation, IK and renderer projection, no browser/GPU or timing gate.
for (const count of [1, 2, 12]) {
  for (const workload of ['idle', 'walk', 'crossfade', 'ik'] as const) {
    test.skipIf(import.meta.env.VITE_PROFILE !== '1')(`${count} Actors, ${workload}`, async () => {
      const actors = Array.from(
        { length: count },
        (_, index) =>
          new Actor({
            id: String(index),
            puppet: new Puppet(puppetScene(), { definition: demoCharacter, autoUpdate: false }),
            puppetOwnership: 'owned',
            locomotion: { walk: 'walk', idle: 'idle', fadeDuration: 120 },
          }),
      );
      const walks: Promise<unknown>[] = [];
      let frame = 0;
      for (const actor of actors) {
        actor.play('idle');
        if (workload !== 'idle') walks.push(actor.walkTo(1e9, 0, { speed: 160 }));
        if (workload === 'ik') {
          actor.puppet.getIK('rightArmIK').setTarget(-80, -40);
          actor.puppet.getIK('rightLegIK').setTarget(-20, 140);
        }
      }
      const step = () => {
        for (const actor of actors) {
          if (workload === 'crossfade' && frame % 10 === 0)
            actor.play(frame % 20 ? 'idle' : 'walk', { fadeDuration: 150 });
          actor.puppet.update(16);
        }
        frame++;
      };
      try {
        for (let index = 0; index < 200; index++) step();
        const samples: number[] = [];
        for (let batch = 0; batch < 7; batch++) {
          const start = performance.now();
          for (let index = 0; index < 300; index++) step();
          samples.push((performance.now() - start) / 300);
        }
        samples.sort((a, b) => a - b);
        console.log(
          `${count} Actors, ${workload}: ${samples[3]!.toFixed(4)} ms/frame; ${((samples[3]! * 1000) / count).toFixed(2)} us/Actor`,
        );
      } finally {
        for (const actor of actors) actor.dispose();
        await Promise.all(walks);
      }
      for (const actor of actors) assert.isTrue(actor.puppet.isDestroyed);
    });
  }
}
