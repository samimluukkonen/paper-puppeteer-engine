import { CharacterTextureBudget } from './characterTextureLimits.js';
import { SCENE_TEXTURE_LIMITS } from './textureBudget.js';

/** Share across character loads; texture keys identify actual allocations, including aliases.
 * Keep the Phaser file guard type outside the renderer-independent workload declarations.
 */
export function createSceneTextureBudget(): CharacterTextureBudget {
  return new CharacterTextureBudget(SCENE_TEXTURE_LIMITS);
}
