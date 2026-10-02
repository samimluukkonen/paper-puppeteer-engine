export type ReadonlyEditorData<T> = T extends object ? { readonly [Key in keyof T]: ReadonlyEditorData<T[Key]> } : T;

/** Freeze owned JSON data recursively; callers clone source data before passing it here. */
export function freezeData<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

export const roundEditorNumber = (value: number): number => Number(value.toFixed(6));
