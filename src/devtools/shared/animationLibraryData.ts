import type { AnimationClip } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';

/** A derived row points to its sole character document. It never owns a second set of keys. */
export interface AnimationLibraryEntry {
  readonly character: string;
  readonly characterName: string;
  readonly rigIdentity: string | undefined;
  readonly clip: DeepReadonly<AnimationClip>;
}

export function animationAssetReference(entry: AnimationLibraryEntry): string {
  return JSON.stringify([entry.character, entry.clip.name]);
}

/** Version-1 characters own their rigs. Matching topology alone does not establish identity. */
export function animationCompatibility(entry: AnimationLibraryEntry, targetRig: string | undefined): string {
  if (!entry.rigIdentity) return 'Source rig is unavailable.';
  if (!targetRig) return 'Choose a target character with an available rig.';
  return entry.rigIdentity === targetRig ? '' : 'Incompatible rig identity. Cross-rig retargeting is not available.';
}

export function existingAnimationReference(entry: AnimationLibraryEntry, targetRig: string | undefined): string {
  const reason = animationCompatibility(entry, targetRig);
  if (reason) throw new Error(reason);
  return entry.clip.name;
}

export function filterAnimationLibrary(
  entries: readonly AnimationLibraryEntry[],
  query: string,
  targetRig?: string,
  compatibleOnly = false,
): readonly AnimationLibraryEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (compatibleOnly && animationCompatibility(entry, targetRig)) return false;
    const text = [entry.clip.name, entry.clip.library?.displayName, ...(entry.clip.library?.tags ?? [])]
      .join(' ')
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function independentAnimationName(name: string, ids: readonly string[]): string {
  const stem = name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^[^a-zA-Z0-9]+/, '') || 'animation';
  const base = `${stem}-variation`;
  let next = base;
  for (let suffix = 2; ids.includes(next); suffix++) next = `${base}-${suffix}`;
  return next;
}
