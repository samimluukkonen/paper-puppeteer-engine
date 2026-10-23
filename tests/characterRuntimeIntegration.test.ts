import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { buildCharacterPackage } from '../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip, encodePackageZip } from '../src/devtools/shared/package/packageZip.js';
import { CharacterLoader, Puppet, type FiredAnimationEvent } from '../src/engine/runtime.js';
import { consumerCharacter, consumerImageFetcher } from './helpers/consumerCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

test.each(['destroy', 'shutdown'] as const)(
  'editor export → relocated CharacterLoader → Puppet → play → %s',
  async (cleanup) => {
    const authored = consumerCharacter();
    const files = decodePackageZip(encodePackageZip(await buildCharacterPackage(authored, consumerImageFetcher)));
    const base = 'https://another-app.test/nested/assets/hero/';
    const requests: string[] = [];
    const definition = await CharacterLoader.load(`${base}character.json`, (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      assert.isTrue(url.startsWith(base));
      requests.push(url);
      const bytes = files.get(decodeURIComponent(url.slice(base.length)));
      return Promise.resolve(bytes ? new Response(bytes) : new Response(null, { status: 404 }));
    });
    assert.equal(requests.length, 15); // manifest, rig, three skins, nine clips, one pose
    for (const [key, path] of Object.entries(definition.textures)) {
      assert.equal(definition.textureUrl(key), `${base}${path}`);
      assert.isTrue(files.has(path));
    }
    assert.deepEqual(
      files.get(definition.textures['paper-head']!),
      new Uint8Array(await authored.replacements[0]!.blob.arrayBuffer()),
    );
    for (const [path, bytes] of files)
      if (path.endsWith('.json')) {
        const text = new TextDecoder().decode(bytes);
        assert.notMatch(text, /blob:|__paper_artwork_|source\.invalid|localhost|\/Users\//);
      }

    const SceneEvents = createRequire(import.meta.url)(
      '../node_modules/phaser/src/events/EventEmitter.js',
    ) as typeof Phaser.Events.EventEmitter;
    const scene = puppetScene();
    const events = new SceneEvents();
    scene.events = events;
    const expected = new Puppet(puppetScene(), {
      rig: authored.rig,
      animations: authored.animations,
      autoUpdate: false,
    });
    const puppet = new Puppet(scene, { definition });
    const delivered: FiredAnimationEvent[] = [];
    const expectedEvents: FiredAnimationEvent[] = [];
    const unsubscribe = puppet.onAnimationEvent((event) => delivered.push(event));
    const stopExpected = expected.onAnimationEvent((event) => expectedEvents.push(event));
    try {
      for (const clip of authored.animations) {
        expected.play(clip.name);
        puppet.play(clip.name);
        for (const delta of [100, 150, 250, 100]) {
          expected.update(delta);
          events.emit('update', 0, delta);
          for (const bone of definition.rig.bones)
            assert.deepEqual(puppet.getBone(bone.id).pose, expected.getBone(bone.id).pose);
        }
      }
      assert.deepEqual(delivered, expectedEvents);
      assert.isTrue(delivered.some((event) => event.name === 'left-footstep'));
      assert.isTrue(delivered.some((event) => event.clip === 'sword' && event.name === 'weapon-ready'));
      assert.isTrue(delivered.some((event) => event.clip === 'baked' && event.name === 'reach-marker'));
      puppet.setSkin('alternate');
      assert.equal(puppet.getAttachment('headVisual'), 'headArmored');
      puppet.setAttachment('headVisual', 'headDefault');
      assert.equal(puppet.getAttachment('headVisual'), 'headDefault');
      puppet.setSkin('default');
      assert.equal(puppet.getSlotImage('headVisual')!.texture.key, 'paper-head');
    } finally {
      unsubscribe();
      stopExpected();
      expected.destroy();
      if (cleanup === 'shutdown') events.emit('shutdown');
      else puppet.destroy();
      puppet.destroy();
    }
    assert.isTrue(puppet.isDestroyed);
    assert.isTrue(puppet.animationPlayer.isDisposed);
    assert.equal(events.listenerCount('update'), 0);
    assert.equal(events.listenerCount('shutdown'), 0);
    const count = delivered.length;
    events.emit('update', 0, 1000);
    puppet.update(1000);
    assert.equal(delivered.length, count);
    assert.isTrue(scene.textures.exists('paper-head'));
  },
);
