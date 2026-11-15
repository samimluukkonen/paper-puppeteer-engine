import { isFullyFrozen, type DeepReadonly } from '../../engine/core.js';
import type { SceneDefinition } from '../../engine/data.js';
import { draftSource } from './draftSource.js';

const fingerprints = new WeakMap<object, string>();

/** Hash each immutable scene once; aggregates contain identities rather than full authored documents. */
export function sceneFingerprint(scene: DeepReadonly<SceneDefinition>): string {
  const reusable = isFullyFrozen(scene);
  const previous = reusable ? fingerprints.get(scene) : undefined;
  if (previous !== undefined) return previous;
  const digest = draftSource(scene);
  if (reusable) fingerprints.set(scene, digest);
  return digest;
}
