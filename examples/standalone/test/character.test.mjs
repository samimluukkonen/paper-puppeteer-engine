import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { AnimationPlayer, CharacterLoader, Joint, evaluateClip } from 'paper-puppeteer-engine/core';

const base = new URL('../public/character/', import.meta.url);
const fetcher = async (input) => new Response(await readFile(new URL(String(input))));

await test('installed runtime loads the extracted export, evaluates authored motion and delivers events', async () => {
  const definition = await CharacterLoader.load(new URL('character.json', base).href, fetcher);
  const joints = new Map(definition.rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const player = new AnimationPlayer(definition.rig, joints, definition.compiledAnimations);
  const events = [];
  const unsubscribe = player.onAnimationEvent((event) => events.push(event));
  try {
    for (const name of ['idle', 'walk', 'sword', 'reach', 'baked']) {
      player.play(name);
      player.update(500);
      assert.equal(player.currentAnimation, name);
      const compiled = definition.compiledAnimations.find((clip) => clip.name === name);
      assert.ok(compiled);
      if (name === 'idle') assert.ok(Math.abs(evaluateClip(compiled, 500).get('torso').rotation - 0.12) < 1e-12);
    }
    assert.ok(events.some((event) => event.clip === 'walk' && event.name === 'left-footstep'));
    assert.ok(events.some((event) => event.clip === 'sword' && event.name === 'weapon-ready'));
    assert.ok(events.some((event) => event.clip === 'baked' && event.name === 'reach-marker'));
    assert.ok(definition.animations.find((clip) => clip.name === 'reach').ikTracks);
    assert.ok(definition.animations.find((clip) => clip.name === 'baked').disabledIKConstraints.length);
    assert.ok(definition.rig.skins.some((skin) => skin.name === 'alternate'));
    for (const [key, path] of Object.entries(definition.textures)) {
      assert.equal(definition.textureUrl(key), new URL(path, base).href);
      assert.ok((await readFile(new URL(path, base))).length > 0);
    }
  } finally {
    unsubscribe();
    player.dispose();
    player.dispose();
  }
  const delivered = events.length;
  player.update(1000);
  assert.equal(events.length, delivered);
  assert.equal(player.isDisposed, true);
});
