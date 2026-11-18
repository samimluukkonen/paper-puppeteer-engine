import { assert, test, vi } from 'vitest';
import { AnimationEditorGhostLayer } from '../src/devtools/animation-editor/AnimationEditorGhostLayer.js';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

// Allocation assertions are deterministic. Optional timings are CPU diagnostics, not GPU/FPS claims.
for (const count of [1, 3]) {
  for (const mode of ['smooth', 'stepped'] as const) {
    test(`bounded ${count}-per-direction pool: 32 bones, 96 slots, 60-second ${mode} clip, rapid scrubs and playback`, () => {
      const bones = Array.from({ length: 32 }, (_, index) => ({
        id: `bone${index}`,
        ...(index ? { parent: `bone${Math.floor((index - 1) / 2)}`, y: 12 } : {}),
        sprite: { texture: 'part', x: 2, y: -3, originX: 0.2, originY: 0.8 },
      }));
      const slots = bones.flatMap((bone) =>
        Array.from({ length: 3 }, (_, index) => ({
          id: `${bone.id}-slot${index}`,
          bone: bone.id,
          x: index * 4,
          depth: index * 17,
        })),
      );
      const rig = new Rig({
        root: 'bone0',
        bones,
        slots,
        attachments: [{ id: 'prop', texture: 'prop', originX: 0.1, originY: 0.9 }],
        skins: [{ version: 1, name: 'all', slots: Object.fromEntries(slots.map((slot) => [slot.id, 'prop'])) }],
      });
      const scene = puppetScene();
      const puppet = new Puppet(scene, { rig, skin: 'all', autoUpdate: false });
      const state = new AnimationEditorState(rig, [
        {
          name: 'long',
          duration: 60000,
          loop: true,
          playback: mode === 'smooth' ? { mode } : { mode, fps: 10 },
          tracks: Object.fromEntries(
            bones.map((bone, index) => [
              bone.id,
              Array.from({ length: 121 }, (_, key) => ({ time: key * 500, rotation: Math.sin(key / 10 + index) })),
            ]),
          ),
        },
      ]);
      state.selectAnimation('long');
      state.setCurrentTime(30);
      const preview = new AnimationEditorPreview(state, puppet);
      const layer = new AnimationEditorGhostLayer(scene, state, puppet);
      const images = vi.spyOn(scene.add, 'image');
      const containers = vi.spyOn(scene.add, 'container');
      const textures = vi.spyOn(scene.textures, 'exists');
      try {
        layer.setSettings({ enabled: true, previousCount: count, nextCount: count });
        assert.equal(images.mock.calls.length, 128 * 2 * count);
        const pool = Reflect.get(layer, 'instances') as Map<string, { container: { isDestroyed: boolean } }>;
        const retained = [...pool.values()];
        images.mockClear();
        containers.mockClear();
        textures.mockClear();
        const exported = state.exportJson();
        const started = performance.now();
        for (let index = 0; index < 240; ++index)
          layer.updateFrame(() => state.setCurrentTime(1 + ((index * 0.137) % 58)));
        const scrubMs = (performance.now() - started) / 240;
        state.setCurrentTime(30);
        state.playback.play();
        const playbackStart = performance.now();
        for (let index = 0; index < 240; ++index) layer.updateFrame(() => state.playback.advancePlayback(1 / 60));
        const playbackMs = (performance.now() - playbackStart) / 240;
        state.playback.pause();
        for (let index = 0; index < 20; ++index) {
          layer.setEnabled(false);
          layer.setEnabled(true);
        }
        assert.equal(images.mock.calls.length, 0);
        assert.equal(containers.mock.calls.length, 0);
        assert.equal(textures.mock.calls.length, 0);
        assert.deepEqual([...pool.values()], retained);
        assert.equal(state.exportJson(), exported);
        assert.isFalse(state.dirty);
        layer.dispose();
        assert.equal(pool.size, 0);
        assert.isTrue(retained.every((ghost) => ghost.container.isDestroyed));
        if (import.meta.env.VITE_PROFILE === '1')
          console.log(
            `onion ${count}/direction ${mode}: ${scrubMs.toFixed(3)} ms/scrub, ${playbackMs.toFixed(3)} ms/playback frame; no new images/containers/texture checks after warmup`,
          );
      } finally {
        images.mockRestore();
        containers.mockRestore();
        textures.mockRestore();
        layer.dispose();
        preview.dispose();
        puppet.destroy();
      }
    });
  }
}
