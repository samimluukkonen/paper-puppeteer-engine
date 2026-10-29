import type { CharacterDefinition } from './CharacterDefinition.js';
import type { DeepReadonly } from './readonlyData.js';
import type { SceneDefinition } from './SceneDefinition.js';

/** Scene-wide limits supplement the per-character budgets, before runtime allocation. */
export const DEFAULT_SCENE_WORKLOAD_LIMITS = Object.freeze({
  maxActors: 256,
  maxActions: 10_000,
  maxTotalBones: 32_768,
  maxTotalSlots: 32_768,
  maxTotalImageBytes: 100 * 1024 * 1024,
  maxTotalImagePixels: 128 * 1024 * 1024,
  maxTotalAudioBytes: 100 * 1024 * 1024,
});

/** Count every instance, including Actors sharing one immutable character definition.
 * Partial editor catalogs count loaded definitions and are rechecked as assets arrive.
 */
export function assertSceneInstanceBudget(
  scene: DeepReadonly<SceneDefinition>,
  characters: ReadonlyMap<string, CharacterDefinition>,
): void {
  let bones = 0;
  let slots = 0;
  for (const actor of scene.actors) {
    const character = characters.get(actor.character.manifest);
    if (!character) continue;
    bones += character.rig.bones.length;
    slots += character.rig.slots.length;
    if (bones > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalBones)
      throw new Error(`Scene exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalBones}-bone instance limit.`);
    if (slots > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalSlots)
      throw new Error(`Scene exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalSlots}-slot instance limit.`);
  }
}
