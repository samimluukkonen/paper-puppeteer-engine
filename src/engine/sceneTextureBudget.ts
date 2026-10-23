import { CharacterTextureBudget } from './characterTextureLimits.js';
import { DEFAULT_SCENE_WORKLOAD_LIMITS } from './sceneWorkloadLimits.js';

/** Share across character loads; texture keys identify actual allocations, including aliases.
 * Keep the Phaser file guard type outside the renderer-independent workload declarations.
 */
export function createSceneTextureBudget(): CharacterTextureBudget {
  return new CharacterTextureBudget({
    allowWebp: true,
    maxTotalImageBytes: DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalImageBytes,
    maxTotalImagePixels: DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalImagePixels,
  });
}
