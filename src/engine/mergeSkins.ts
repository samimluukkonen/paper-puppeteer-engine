import type { SkinDefinition } from './types.js';

/** Standalone character skins override matching embedded names, preserving rig-only skins. */
export function mergeSkins(
  embedded: readonly SkinDefinition[],
  standalone: readonly SkinDefinition[] = [],
): SkinDefinition[] {
  const skins = new Map(embedded.map((skin) => [skin.name, skin]));
  for (const skin of standalone) skins.set(skin.name, skin);
  return [...skins.values()];
}
