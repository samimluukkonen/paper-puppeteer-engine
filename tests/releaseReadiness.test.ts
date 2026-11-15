import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { assert, expect, test, vi } from 'vitest';
import {
  buildCharacterPackage,
  loadPackageDefinition,
  type PackageFiles,
  validatePackage,
} from '../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip, encodePackageZip } from '../src/devtools/shared/package/packageZip.js';
import { Puppet } from '../src/engine/runtime.js';
import { consumerCharacter, consumerImageFetcher } from './helpers/consumerCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const SceneEvents = createRequire(import.meta.url)(
  '../node_modules/phaser/src/events/EventEmitter.js',
) as typeof Phaser.Events.EventEmitter;

function packageFetcher(files: PackageFiles): typeof fetch {
  return (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const bytes = files.get(decodeURIComponent(url.pathname.slice(1)));
    return Promise.resolve(bytes ? new Response(bytes) : new Response(null, { status: 404 }));
  };
}

test('ten complete editor ZIP → loader → re-export cycles retain metadata, paths and image bytes', async () => {
  let files = decodePackageZip(
    encodePackageZip(await buildCharacterPackage(consumerCharacter(), consumerImageFetcher)),
  );
  const original = new Map(files);
  for (let cycle = 0; cycle < 10; ++cycle) {
    const definition = await validatePackage(files);
    files = decodePackageZip(
      encodePackageZip(
        await buildCharacterPackage(
          {
            definition,
            rig: structuredClone(definition.rigFile!),
            skins: definition.standaloneSkins,
            animations: definition.animations,
            replacements: [],
          },
          packageFetcher(files),
        ),
      ),
    );
    assert.deepEqual([...files.keys()].sort(), [...original.keys()].sort());
    for (const [path, bytes] of files) assert.deepEqual(bytes, original.get(path), `cycle ${cycle}: ${path}`);
  }
});

test('rejected package loads leave a live character playing and allow the next valid load', async () => {
  const files = await buildCharacterPackage(consumerCharacter(), consumerImageFetcher);
  const definition = await loadPackageDefinition(files);
  const puppet = new Puppet(puppetScene(), { definition, autoUpdate: false });
  const delivered: string[] = [];
  const stop = puppet.onAnimationEvent((event) => delivered.push(event.name));
  try {
    puppet.play('walk');
    for (const path of [definition.manifest!.rig, definition.manifest!.animations[0]!]) {
      const broken = new Map(files);
      broken.delete(path);
      await expect(loadPackageDefinition(broken)).rejects.toThrow('rejected by policy');
      puppet.update(600);
      assert.isFalse(puppet.isDestroyed);
      assert.equal((await loadPackageDefinition(files)).id, definition.id);
    }
    assert.include(delivered, 'left-footstep');
  } finally {
    stop();
    puppet.destroy();
  }
});

for (const instances of [1, 20]) {
  test(
    `${instances} simultaneous puppets: ten load/play/skin/facing/shutdown cycles release objects and listeners`,
    { timeout: 30000 },
    async () => {
      const files = await buildCharacterPackage(consumerCharacter(), consumerImageFetcher);
      const scene = puppetScene();
      const events = new SceneEvents();
      scene.events = events;
      const createContainer = vi.spyOn(scene.add, 'container');
      const createImage = vi.spyOn(scene.add, 'image');
      const loadTimes: number[] = [];
      const frameTimes: number[] = [];
      let delivered = 0;
      try {
        for (let cycle = 0; cycle < 10; ++cycle) {
          const start = performance.now();
          const definition = await loadPackageDefinition(files);
          loadTimes.push(performance.now() - start);
          const puppets: Puppet[] = [];
          try {
            for (let index = 0; index < instances; ++index) {
              const puppet = new Puppet(scene, { definition });
              puppets.push(puppet);
              puppet.onAnimationEvent(() => ++delivered);
              puppet.play('walk');
              puppet.setSkin('alternate');
              puppet.setFacing(index % 2 ? 'left' : 'right');
            }
            assert.equal(events.listenerCount('update'), instances);
            const frameStart = performance.now();
            for (let frame = 0; frame < 60; ++frame) events.emit('update', frame * 16, 16);
            frameTimes.push((performance.now() - frameStart) / 60);
            for (const puppet of puppets) {
              puppet.play('baked', { fadeDuration: 150 });
              puppet.setSkin('default');
            }
            events.emit('update', 0, 600);
            // Alternate host shutdown with explicit per-puppet cleanup, reusing one scene emitter.
            if (cycle % 2) events.emit('shutdown');
          } finally {
            for (const puppet of puppets) puppet.destroy();
          }
          assert.isTrue(puppets.every((puppet) => puppet.isDestroyed && puppet.posePipeline.player.isDisposed));
          assert.equal(events.listenerCount('update'), 0);
          assert.equal(events.listenerCount('shutdown'), 0);
          for (const result of [...createContainer.mock.results, ...createImage.mock.results]) {
            assert.equal(result.type, 'return');
            assert.equal(Reflect.get(result.value, 'isDestroyed'), true);
          }
          createContainer.mockClear();
          createImage.mockClear();
          const before = delivered;
          events.emit('update', 0, 1000);
          assert.equal(delivered, before);
        }
        assert.isAbove(delivered, 0);
        if (import.meta.env.VITE_PROFILE === '1') {
          const median = (values: number[]) => {
            const sorted = values.slice().sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            return (sorted[middle - 1]! + sorted[middle]!) / 2;
          };
          console.log(
            `${instances} puppets: ${median(loadTimes).toFixed(3)} ms/metadata load; ${median(frameTimes).toFixed(3)} ms/update batch; ten cycles, zero retained scene listeners or live mocked containers/images`,
          );
        }
      } finally {
        createContainer.mockRestore();
        createImage.mockRestore();
      }
    },
  );
}
