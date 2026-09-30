import type { AnimationClip, AnimationPlaybackMode, Interpolation, Keyframe } from './AnimationClip.js';
import { Rig } from './Rig.js';
import { animationClipSchema, rigDefinitionSchema } from './schemas.js';
import type { BoneDefinition, RigDefinition } from './types.js';

export const RIG_FORMAT_VERSION = 1;
export const ANIMATION_FORMAT_VERSION = 1;

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** File format for a rig. The optional name is metadata; bone ids identify runtime joints. */
export interface RigJsonDefinition {
  version: typeof RIG_FORMAT_VERSION;
  name?: string;
  root: string;
  bones: readonly BoneDefinition[];
}

export interface AnimationJsonEvent {
  time: number;
  name: string;
  data?: JsonValue;
}

/** File format for a clip; event payloads must be JSON values. */
export interface AnimationJsonDefinition {
  version: typeof ANIMATION_FORMAT_VERSION;
  name: string;
  duration: number;
  loop: boolean;
  interpolation?: Interpolation;
  tracks: Readonly<Record<string, readonly Keyframe[]>>;
  events?: readonly AnimationJsonEvent[];
  playback?: AnimationPlaybackMode;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  path?: string;
  message: string;
}

export class RigValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(
      `Invalid rig definition:\n${issues.map((issue) => `${issue.path ?? '(root)'}: ${issue.message}`).join('\n')}`,
    );
    this.name = 'RigValidationError';
  }
}

export class AnimationValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(
      `Invalid animation definition:\n${issues.map((issue) => `${issue.path ?? '(root)'}: ${issue.message}`).join('\n')}`,
    );
    this.name = 'AnimationValidationError';
  }
}

export class UnsupportedFormatVersionError extends Error {
  constructor(
    readonly format: 'rig' | 'animation',
    readonly version: unknown,
    readonly supportedVersion: number,
  ) {
    super(`Unsupported ${format} format version ${String(version)}; supported version is ${supportedVersion}.`);
    this.name = 'UnsupportedFormatVersionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

/** Reject values that JSON.stringify would silently omit, coerce, or recurse through forever. */
function checkJson(value: unknown, path: string, issues: ValidationIssue[], ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push({ severity: 'error', path, message: 'Must be a finite JSON number.' });
    return;
  }
  if (typeof value !== 'object') {
    issues.push({
      severity: 'error',
      path,
      message: 'Must be a JSON value (no functions, undefined, bigint, or symbols).',
    });
    return;
  }
  if (ancestors.has(value)) {
    issues.push({ severity: 'error', path, message: 'Cyclic references are not allowed.' });
    return;
  }
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    issues.push({ severity: 'error', path, message: 'Must be a plain JSON object (no class instances, Map, or Set).' });
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor)
        issues.push({ severity: 'error', path: childPath(path, index), message: 'Sparse arrays are not JSON data.' });
      else if (!('value' in descriptor))
        issues.push({
          severity: 'error',
          path: childPath(path, index),
          message: 'Accessor properties are not JSON data.',
        });
      else checkJson(descriptor.value, childPath(path, index), issues, ancestors);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key === 'string') {
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && index < value.length && String(index) === key) continue;
      }
      issues.push({ severity: 'error', path, message: 'Array properties outside numeric indexes are not JSON data.' });
    }
  } else {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        issues.push({ severity: 'error', path, message: 'Symbol keys are not JSON data.' });
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor))
        issues.push({
          severity: 'error',
          path: childPath(path, key),
          message: 'Hidden or accessor properties are not JSON data.',
        });
      else checkJson(descriptor.value, childPath(path, key), issues, ancestors);
    }
  }
  ancestors.delete(value);
}

function shapeIssues(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): ValidationIssue[] {
  return error.issues.map((issue) => ({
    severity: 'error',
    path: issue.path.reduce<string>((path, key) => childPath(path, key as string | number), ''),
    message: issue.message,
  }));
}

function versionIssues(input: unknown, expected: number, format: 'rig' | 'animation'): ValidationIssue[] {
  if (!isRecord(input) || !Object.hasOwn(input, 'version'))
    return [{ severity: 'error', path: 'version', message: `${format} format version is required.` }];
  if (input.version !== expected)
    return [
      {
        severity: 'error',
        path: 'version',
        message: `Unsupported ${format} format version ${String(input.version)}; supported version is ${expected}.`,
      },
    ];
  return [];
}

const transformKeys = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];

function checkKnownKeys(value: unknown, path: string, allowed: readonly string[], issues: ValidationIssue[]): void {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      issues.push({ severity: 'error', path: childPath(path, key), message: `Unknown field "${key}".` });
  }
}

function checkRigFields(input: unknown, issues: ValidationIssue[]): void {
  checkKnownKeys(input, '', ['version', 'name', 'root', 'bones'], issues);
  if (!isRecord(input) || !Array.isArray(input.bones)) return;
  for (const [index, bone] of input.bones.entries()) {
    const path = `bones[${index}]`;
    checkKnownKeys(bone, path, ['id', 'parent', 'length', 'sprite', 'depth', ...transformKeys], issues);
    if (isRecord(bone))
      checkKnownKeys(
        bone.sprite,
        `${path}.sprite`,
        ['texture', 'frame', 'x', 'y', 'originX', 'originY', 'scaleX', 'scaleY', 'depth'],
        issues,
      );
  }
}

function checkAnimationFields(input: unknown, issues: ValidationIssue[]): void {
  checkKnownKeys(
    input,
    '',
    ['version', 'name', 'duration', 'loop', 'interpolation', 'tracks', 'events', 'playback'],
    issues,
  );
  if (!isRecord(input)) return;
  checkKnownKeys(input.playback, 'playback', ['mode', 'fps'], issues);
  if (isRecord(input.tracks)) {
    for (const [bone, keys] of Object.entries(input.tracks)) {
      if (!Array.isArray(keys)) continue;
      for (const [index, key] of keys.entries())
        checkKnownKeys(key, `tracks.${bone}[${index}]`, ['time', ...transformKeys], issues);
    }
  }
  if (Array.isArray(input.events)) {
    for (const [index, event] of input.events.entries())
      checkKnownKeys(event, `events[${index}]`, ['time', 'name', 'data'], issues);
  }
}

/** Reports all detectable file, scalar and hierarchy errors without creating engine state. */
export function validateRigDefinition(input: unknown): ValidationIssue[] {
  const issues = versionIssues(input, RIG_FORMAT_VERSION, 'rig');
  checkJson(input, '', issues);
  if (issues.some((issue) => issue.message.includes('accessor'))) return issues;
  checkRigFields(input, issues);
  const parsed = rigDefinitionSchema.safeParse(input);
  if (!parsed.success) return [...issues, ...shapeIssues(parsed.error)];
  const { root, bones } = parsed.data;
  if (isRecord(input) && input.name !== undefined && (typeof input.name !== 'string' || input.name.length === 0))
    issues.push({ severity: 'error', path: 'name', message: 'Rig name must be a nonempty string.' });
  const ids = new Map<string, number>();
  for (const [index, bone] of bones.entries()) {
    if (ids.has(bone.id))
      issues.push({ severity: 'error', path: `bones[${index}].id`, message: `Duplicate bone id "${bone.id}".` });
    else ids.set(bone.id, index);
  }
  if (!ids.has(root)) issues.push({ severity: 'error', path: 'root', message: `Root bone "${root}" is missing.` });
  for (const [index, bone] of bones.entries()) {
    if (bone.id === root && bone.parent !== undefined)
      issues.push({
        severity: 'error',
        path: `bones[${index}].parent`,
        message: 'The root bone cannot have a parent.',
      });
    if (bone.id !== root && bone.parent === undefined)
      issues.push({ severity: 'error', path: `bones[${index}].parent`, message: `Bone "${bone.id}" needs a parent.` });
    if (bone.parent !== undefined && !ids.has(bone.parent))
      issues.push({
        severity: 'error',
        path: `bones[${index}].parent`,
        message: `Bone "${bone.id}" references unknown parent "${bone.parent}".`,
      });
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const index = ids.get(id);
    const parent = index === undefined ? undefined : bones[index]?.parent;
    if (parent !== undefined && ids.has(parent)) {
      if (visiting.has(parent))
        issues.push({
          severity: 'error',
          path: `bones[${index}].parent`,
          message: `Circular hierarchy involving "${id}" and "${parent}".`,
        });
      else visit(parent);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids.keys()) visit(id);
  return issues;
}

/** Validate a versioned file and return the same Rig used by TypeScript-defined puppets. */
export function parseRigDefinition(input: unknown): Rig {
  const issues = validateRigDefinition(input);
  if (issues.length) {
    if (isRecord(input) && Object.hasOwn(input, 'version') && input.version !== RIG_FORMAT_VERSION)
      throw new UnsupportedFormatVersionError('rig', input.version, RIG_FORMAT_VERSION);
    throw new RigValidationError(issues);
  }
  return new Rig(rigDefinitionSchema.parse(input));
}

/** Reports file, scalar, timeline and rig-reference errors. */
export function validateAnimationDefinition(input: unknown, rig: Rig | RigDefinition): ValidationIssue[] {
  const issues = versionIssues(input, ANIMATION_FORMAT_VERSION, 'animation');
  checkJson(input, '', issues);
  if (issues.some((issue) => issue.message.includes('accessor'))) return issues;
  checkAnimationFields(input, issues);
  const parsed = animationClipSchema.safeParse(input);
  if (!parsed.success) return [...issues, ...shapeIssues(parsed.error)];
  const clip = parsed.data;
  const boneIds = new Set(rig.bones.map((bone) => bone.id));
  for (const [bone, keys] of Object.entries(clip.tracks)) {
    if (!boneIds.has(bone))
      issues.push({
        severity: 'error',
        path: `tracks.${bone}`,
        message: `Animation "${clip.name}" references unknown bone "${bone}".`,
      });
    let previousTime = -1;
    for (const [index, key] of keys.entries()) {
      if (key.time < 0 || key.time > clip.duration || key.time <= previousTime)
        issues.push({
          severity: 'error',
          path: `tracks.${bone}[${index}].time`,
          message: 'Keyframe time must increase strictly and stay within the animation duration.',
        });
      previousTime = key.time;
    }
  }
  for (const [index, event] of (clip.events ?? []).entries()) {
    if (event.time < 0 || event.time > clip.duration)
      issues.push({
        severity: 'error',
        path: `events[${index}].time`,
        message: 'Event time must stay within the animation duration.',
      });
  }
  return issues;
}

/** Validate a versioned file and return an ordinary clip for AnimationPlayer.addAnimation. */
export function parseAnimationClip(input: unknown, rig: Rig | RigDefinition): AnimationClip {
  const issues = validateAnimationDefinition(input, rig);
  if (issues.length) {
    if (isRecord(input) && Object.hasOwn(input, 'version') && input.version !== ANIMATION_FORMAT_VERSION)
      throw new UnsupportedFormatVersionError('animation', input.version, ANIMATION_FORMAT_VERSION);
    throw new AnimationValidationError(issues);
  }
  return animationClipSchema.parse(input);
}
