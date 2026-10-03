import type { ValidationIssue } from './validation.js';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

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
  if (ancestors.has(value)) {
    issues.push({ severity: 'error', path, message: 'Cyclic references are not allowed.' });
    return false;
  }
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
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
      } else if (!checkJson(descriptor.value, childPath(path, index), issues, ancestors)) safeToInspect = false;
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
      } else if (!checkJson(descriptor.value, childPath(path, key), issues, ancestors)) safeToInspect = false;
    }
  }
  ancestors.delete(value);
  return safeToInspect;
}

/** Copy JSON payloads while retaining reference semantics for arbitrary runtime values. */
export function copyJsonData<Value>(value: Value): Value {
  const issues: ValidationIssue[] = [];
  return checkJson(value, '', issues) && issues.length === 0 ? structuredClone(value) : value;
}
