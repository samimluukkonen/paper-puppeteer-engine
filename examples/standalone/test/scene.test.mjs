import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  buildScenePackage,
  decodePackageZip,
  encodePackageZip,
  parseSceneJson,
  validateScenePackage,
} from 'paper-puppeteer-engine/core';

await test('installed scene APIs package and reload the actual standalone authored scene and artwork', async () => {
  const source = parseSceneJson(await readFile(new URL('../public/scene.json', import.meta.url), 'utf8'));
  const original = structuredClone(source);
  const fetcher = async (input) => {
    const path = new URL(String(input)).pathname.slice(1);
    return new Response(await readFile(new URL(`../public/${path}`, import.meta.url)));
  };
  const files = await buildScenePackage(source, { baseUrl: 'https://standalone.invalid/scene.json', fetcher });
  const resolved = await validateScenePackage(decodePackageZip(encodePackageZip(files)));
  assert.equal(resolved.characters.size, 1);
  assert.equal(resolved.definition.actors.length, 2);
  assert.deepEqual(resolved.definition.actions, source.actions);
  assert.deepEqual(source, original);
  const character = [...resolved.characters.values()][0];
  assert.ok(character.animations.some((clip) => clip.name === 'recover'));
  assert.ok(Object.keys(character.textures).length > 0);
  assert.ok([...files.keys()].some((path) => path.endsWith('.png')));
});
