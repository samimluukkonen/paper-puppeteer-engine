import type { DeepReadonly } from '../../engine/readonlyData.js';

export { freezeData } from '../../engine/readonlyData.js';
export type ReadonlyEditorData<T> = DeepReadonly<T>;

export const roundEditorNumber = (value: number): number => Number(value.toFixed(6));
