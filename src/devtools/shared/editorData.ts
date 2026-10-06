import type { DeepReadonly } from '../../engine/readonlyData.js';

export { freezeData, isFullyFrozen } from '../../engine/readonlyData.js';
export type ReadonlyEditorData<T> = DeepReadonly<T>;

export const roundEditorNumber = (value: number): number => Number(value.toFixed(6));

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
