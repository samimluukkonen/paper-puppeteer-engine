export type DeepReadonly<T> = T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

/** Freeze owned JSON data recursively; callers clone source data before passing it here. */
export function freezeData<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

/** Own a map's entries and expose only reading operations; Object.freeze alone cannot protect a Map. */
export function readonlyMap<Key, Value>(entries: Iterable<readonly [Key, Value]>): ReadonlyMap<Key, Value> {
  const data = new Map(entries);
  const view: ReadonlyMap<Key, Value> = Object.freeze({
    get size() {
      return data.size;
    },
    get: (key: Key) => data.get(key),
    has: (key: Key) => data.has(key),
    entries: () => data.entries(),
    keys: () => data.keys(),
    values: () => data.values(),
    [Symbol.iterator]: () => data[Symbol.iterator](),
    forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown) {
      data.forEach((value, key) => {
        callback.call(thisArg, value, key, view);
      });
    },
  });
  return view;
}
