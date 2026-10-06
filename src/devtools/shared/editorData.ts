import type { DeepReadonly } from '../../engine/readonlyData.js';

export { freezeData } from '../../engine/readonlyData.js';
export type ReadonlyEditorData<T> = DeepReadonly<T>;

export const roundEditorNumber = (value: number): number => Number(value.toFixed(6));

/** Readonly types or a shallow freeze alone do not prevent edits to nested caller data. */
export function isFullyFrozen(data: object): boolean {
  const pending = [data];
  const seen = new Set<object>();
  while (pending.length) {
    const value = pending.pop()!;
    if (seen.has(value)) continue;
    seen.add(value);
    if (!Object.isFrozen(value)) return false;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      // Frozen getters can still expose changing values; never invoke them during ownership checks.
      if (!Object.hasOwn(descriptor, 'value')) return false;
      const child: unknown = descriptor.value;
      if (child !== null && typeof child === 'object') pending.push(child);
    }
  }
  return true;
}

/** Compare owned JSON data, skipping shared immutable branches and ignoring object key order. */
export function equalEditorData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left))
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => equalEditorData(entry, right[index]))
    );
  if (Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalEditorData(a[key], b[key]))
  );
}
