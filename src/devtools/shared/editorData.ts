import type { DeepReadonly } from '../../engine/data.js';

export { freezeData, isFullyFrozen, equalJsonData as equalEditorData } from '../../engine/core.js';
export type ReadonlyEditorData<T> = DeepReadonly<T>;

export const roundEditorNumber = (value: number): number => Number(value.toFixed(6));
