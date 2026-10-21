import { isFullyFrozen } from './readonlyData.js';
import type { ValidationIssue } from './validation.js';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

// Bound recursion before schema parsing, cloning, freezing, or serialization can overflow.
const maximumJsonNesting = 256;

/** Same-origin editor hosts can supply another realm's Object.prototype. Inspect
 * descriptors without invoking user accessors; class prototypes remain invalid. */
function plainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype === null || prototype === Object.prototype) return true;
  if (typeof prototype !== 'object' || Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  return (
    !!constructor &&
    'value' in constructor &&
    typeof constructor.value === 'function' &&
    Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(Object)
  );
}

export function childPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

/** Reject non-JSON data using descriptors. Returns whether schema reads are safe; nonfinite numbers remain safe to inspect. */
export function checkJson(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  ancestors = new Set<object>(),
): boolean {
  return inspectJson(value, path, issues, ancestors, 0);
}

function inspectJson(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  ancestors: Set<object>,
  depth: number,
): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push({ severity: 'error', path, message: 'Must be a finite JSON number.' });
    return true;
  }
  if (typeof value !== 'object') {
    issues.push({
      severity: 'error',
      path,
      message: 'Must be a JSON value (no functions, undefined, bigint, or symbols).',
    });
    return false;
  }
  if (depth >= maximumJsonNesting) {
    issues.push({ severity: 'error', path, message: `JSON nesting must not exceed ${maximumJsonNesting} levels.` });
    return false;
  }
  if (ancestors.has(value)) {
    issues.push({ severity: 'error', path, message: 'Cyclic references are not allowed.' });
    return false;
  }
  if (!Array.isArray(value) && !plainObject(value)) {
    issues.push({ severity: 'error', path, message: 'Must be a plain JSON object (no class instances, Map, or Set).' });
    return false;
  }
  let safeToInspect = true;
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor) {
        safeToInspect = false;
        issues.push({ severity: 'error', path: childPath(path, index), message: 'Sparse arrays are not JSON data.' });
      } else if (!('value' in descriptor)) {
        safeToInspect = false;
        issues.push({
          severity: 'error',
          path: childPath(path, index),
          message: 'Accessor properties are not JSON data.',
        });
      } else if (!inspectJson(descriptor.value, childPath(path, index), issues, ancestors, depth + 1))
        safeToInspect = false;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key === 'string') {
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && index < value.length && String(index) === key) continue;
      }
      safeToInspect = false;
      issues.push({ severity: 'error', path, message: 'Array properties outside numeric indexes are not JSON data.' });
    }
  } else {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        safeToInspect = false;
        issues.push({ severity: 'error', path, message: 'Symbol keys are not JSON data.' });
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        safeToInspect = false;
        issues.push({
          severity: 'error',
          path: childPath(path, key),
          message: 'Hidden or accessor properties are not JSON data.',
        });
      } else if (!inspectJson(descriptor.value, childPath(path, key), issues, ancestors, depth + 1))
        safeToInspect = false;
    }
  }
  ancestors.delete(value);
  return safeToInspect;
}

interface JsonCopyProfile {
  readonly clone: boolean;
  readonly work: number;
}
const immutableCopyProfiles = new WeakMap<object, JsonCopyProfile>();

/** JSON nodes and string/key code units approximate repeated traversal and allocation work. */
function copyWork(value: unknown): number {
  if (typeof value === 'string') return 1 + value.length;
  if (value === null || typeof value !== 'object') return 1;
  return Object.entries(value).reduce(
    (work, [key, child]) => work + (Array.isArray(value) ? 0 : key.length) + copyWork(child),
    1,
  );
}

function copyProfile(value: unknown): JsonCopyProfile {
  if (value === null || typeof value !== 'object') {
    const work =
      typeof value === 'string'
        ? 1 + value.length
        : value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
          ? 1
          : 0;
    return { clone: false, work };
  }
  const cached = immutableCopyProfiles.get(value);
  if (cached) return cached;
  const issues: ValidationIssue[] = [];
  const json = checkJson(value, '', issues) && issues.length === 0;
  const profile = { clone: json, work: json ? copyWork(value) : 0 };
  // A shallow freeze is insufficient: nested runtime payloads may still change shape.
  if (isFullyFrozen(value)) immutableCopyProfiles.set(value, profile);
  return profile;
}

/** @internal Non-JSON runtime data is passed by reference and does not incur JSON-copy work. */
export function jsonDataCopyWork(value: unknown): number {
  return copyProfile(value).work;
}

/** Copy JSON payloads; only deeply immutable inputs can reuse their validation result. */
export function copyJsonData<Value>(value: Value): Value {
  return copyProfile(value).clone ? structuredClone(value) : value;
}
