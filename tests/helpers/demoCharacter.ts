import { readFileSync } from 'node:fs';
import type { AnimationClip } from '../../src/engine/AnimationClip.js';
import { CharacterDefinition, characterManifestSchema } from '../../src/engine/CharacterDefinition.js';

const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../public/characters/demo-puppet/${path}`, import.meta.url), 'utf8'));
const manifest = characterManifestSchema.parse(read('character.json'));

/** Tests and profiles exercise the same character files loaded by the browser demo. */
export const demoCharacter = CharacterDefinition.fromData({
  manifest,
  rig: read(manifest.rig),
  skins: Object.fromEntries(Object.values(manifest.skins).map((path) => [path, read(path)])),
  animations: Object.fromEntries(manifest.animations.map((path) => [path, read(path)])),
  poses: Object.fromEntries((manifest.poses ?? []).map((path) => [path, read(path)])),
});
export const demoRig = demoCharacter.rig;
export const demoAnimations = demoCharacter.animations;
const animation = (name: string): AnimationClip => {
  const clip = demoAnimations.find((clip) => clip.name === name);
  if (!clip) throw new Error(`Missing demo animation "${name}".`);
  return clip;
};
export const idle = animation('idle');
export const walk = animation('walk');
export const sword = animation('sword');
export const guardUpperBody = animation('guardUpperBody');
