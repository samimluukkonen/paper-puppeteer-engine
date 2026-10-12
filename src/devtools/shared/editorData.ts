import type { DeepReadonly } from '../../engine/readonlyData.js';

export { freezeData, isFullyFrozen } from '../../engine/readonlyData.js';
export type ReadonlyEditorData<T> = DeepReadonly<T>;

export const roundEditorNumber = (value: number): number => Number(value.toFixed(6));

export { equalJsonData as equalEditorData } from '../../engine/equalJsonData.js';
