import { test, vi } from 'vitest';
import { rendererFixture } from './helpers/rendererFixture.js';

vi.mock('phaser', () => ({ default: {} }));

// Optional CPU/allocation diagnostics; no machine-dependent timing thresholds.
for (const count of [32, 128]) {
  for (const workload of ['chain leaf slot', 'chain all sprites', 'shallow leaf slot'] as const) {
    test.skipIf(import.meta.env.VITE_PROFILE !== '1')(
      `renderer ${count} bones, ${workload}`,
      { timeout: 30000 },
      () => {
        const { renderer, bones, allocations } = rendererFixture({
          root: 'bone0',
          bones: Array.from({ length: count }, (_, index) => ({
            id: `bone${index}`,
            ...(index ? { parent: workload === 'shallow leaf slot' ? 'bone0' : `bone${index - 1}`, y: 10 } : {}),
            ...(workload === 'chain all sprites' ? { sprite: { texture: 'part' } } : {}),
          })),
          ...(workload !== 'chain all sprites' ? { slots: [{ id: 'item', bone: `bone${count - 1}` }] } : {}),
        });
        const animated = bones.get('bone0')!;
        const frame = () => {
          animated.pose.rotation += 0.001;
          animated.syncTransform();
          renderer.sync();
        };
        for (let frameIndex = 0; frameIndex < 500; frameIndex += 1) frame();
        const timings: number[] = [];
        for (let batch = 0; batch < 7; batch += 1) {
          const start = performance.now();
          for (let frameIndex = 0; frameIndex < 1000; frameIndex += 1) frame();
          timings.push(((performance.now() - start) * 1000) / 1000);
        }
        timings.sort((a, b) => a - b);
        console.log(
          `renderer ${count} bones, ${workload}: ${allocations.projections} transform copies, ${allocations.containers} containers; ${timings[3]!.toFixed(2)} us/sync (median of 7 batches)`,
        );
        renderer.destroy();
      },
    );
  }
}
