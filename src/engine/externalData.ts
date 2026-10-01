import type { z } from 'zod';
import type { AnimationClip } from './AnimationClip.js';
import { Rig } from './Rig.js';
import {
  ANIMATION_FORMAT_VERSION,
  animationClipSchema,
  animationEventSchema,
  animationFileSchema,
  boneDefinitionSchema,
  keyframeSchema,
  RIG_FORMAT_VERSION,
  rigDefinitionSchema,
  rigFileSchema,
  skinDefinitionSchema,
  slotDefinitionSchema,
  smoothPlaybackSchema,
  spriteAttachmentSchema,
  spriteSchema,
  steppedPlaybackSchema,
} from './schemas.js';
import type { RigDefinition, SkinDefinition } from './types.js';
import {
  checkAnimationReferences,
  checkRigReferences,
  checkSkinReferences,
  type ValidationIssue,
} from './validation.js';

export { ANIMATION_FORMAT_VERSION, RIG_FORMAT_VERSION } from './schemas.js';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** File format for a rig. The optional name is metadata; bone ids identify runtime joints. */
export interface RigJsonDefinition extends RigDefinition {
  version: typeof RIG_FORMAT_VERSION;
  name?: string;
}

export interface AnimationJsonEvent {
  time: number;
  name: string;
  data?: JsonValue;
}

/** File format for a clip; event payloads must be JSON values. */
export interface AnimationJsonDefinition extends AnimationClip {
  version: typeof ANIMATION_FORMAT_VERSION;
  events?: readonly AnimationJsonEvent[];
}

export type { ValidationIssue } from './validation.js';

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
    readonly format: 'rig' | 'animation' | 'skin' | 'pose',
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
export function checkJson(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  ancestors = new Set<object>(),
): void {
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

function versionIssues(input: unknown, expected: number, format: 'rig' | 'animation' | 'skin'): ValidationIssue[] {
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

function checkKnownKeys(value: unknown, path: string, schema: z.ZodObject, issues: ValidationIssue[]): void {
  if (!isRecord(value)) return;
  const allowed = Object.keys(schema.shape);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      issues.push({ severity: 'error', path: childPath(path, key), message: `Unknown field "${key}".` });
  }
}

function checkRigFields(input: unknown, issues: ValidationIssue[]): void {
  checkKnownKeys(input, '', rigFileSchema, issues);
  if (!isRecord(input) || !Array.isArray(input.bones)) return;
  for (const [index, bone] of input.bones.entries()) {
    const path = `bones[${index}]`;
    checkKnownKeys(bone, path, boneDefinitionSchema, issues);
    if (isRecord(bone)) checkKnownKeys(bone.sprite, `${path}.sprite`, spriteSchema, issues);
  }
  if (Array.isArray(input.slots))
    for (const [index, slot] of input.slots.entries())
      checkKnownKeys(slot, `slots[${index}]`, slotDefinitionSchema, issues);
  if (Array.isArray(input.attachments))
    for (const [index, attachment] of input.attachments.entries())
      checkKnownKeys(attachment, `attachments[${index}]`, spriteAttachmentSchema, issues);
  if (Array.isArray(input.skins))
    for (const [index, skin] of input.skins.entries())
      checkKnownKeys(skin, `skins[${index}]`, skinDefinitionSchema, issues);
}

function checkAnimationFields(input: unknown, issues: ValidationIssue[]): void {
  checkKnownKeys(input, '', animationFileSchema, issues);
  if (!isRecord(input)) return;
  checkKnownKeys(
    input.playback,
    'playback',
    isRecord(input.playback) && input.playback.mode === 'smooth' ? smoothPlaybackSchema : steppedPlaybackSchema,
    issues,
  );
  if (isRecord(input.tracks)) {
    for (const [bone, keys] of Object.entries(input.tracks)) {
      if (!Array.isArray(keys)) continue;
      for (const [index, key] of keys.entries())
        checkKnownKeys(key, `tracks.${bone}[${index}]`, keyframeSchema, issues);
    }
  }
  if (Array.isArray(input.events)) {
    for (const [index, event] of input.events.entries())
      checkKnownKeys(event, `events[${index}]`, animationEventSchema, issues);
  }
}

interface ValidationResult<T> {
  issues: ValidationIssue[];
  data?: T;
}

/** @internal Retains validated data so character assembly need not parse the file again. */
export function inspectRigDefinition(input: unknown): ValidationResult<RigDefinition> {
  const issues = versionIssues(input, RIG_FORMAT_VERSION, 'rig');
  checkJson(input, '', issues);
  if (issues.some((issue) => issue.message.includes('accessor'))) return { issues };
  checkRigFields(input, issues);
  const parsed = rigDefinitionSchema.safeParse(input);
  if (!parsed.success) return { issues: [...issues, ...shapeIssues(parsed.error)] };
  if (isRecord(input) && input.name !== undefined) {
    const name = rigFileSchema.shape.name.safeParse(input.name);
    if (!name.success) issues.push(...shapeIssues(name.error).map((issue) => ({ ...issue, path: 'name' })));
  }
  checkRigReferences(parsed.data, (issue) => issues.push(issue));
  return issues.length ? { issues } : { issues, data: parsed.data };
}

/** @internal Checks standalone skins against an already validated rig. */
export function validateSkinReferences(skins: readonly SkinDefinition[], rig: RigDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  checkSkinReferences(skins, rig, (issue) => issues.push(issue));
  return issues;
}

/** Reports all detectable file, scalar and hierarchy errors without creating engine state. */
export function validateRigDefinition(input: unknown): ValidationIssue[] {
  return inspectRigDefinition(input).issues;
}

/** Validate a versioned file and return the same Rig used by TypeScript-defined puppets. */
export function parseRigDefinition(input: unknown): Rig {
  const { issues, data } = inspectRigDefinition(input);
  if (!data) {
    if (isRecord(input) && Object.hasOwn(input, 'version') && input.version !== RIG_FORMAT_VERSION)
      throw new UnsupportedFormatVersionError('rig', input.version, RIG_FORMAT_VERSION);
    throw new RigValidationError(issues);
  }
  return new Rig(data);
}

/** @internal Retains validated clips for character assembly. */
export function inspectAnimationDefinition(input: unknown, rig: Rig | RigDefinition): ValidationResult<AnimationClip> {
  const issues = versionIssues(input, ANIMATION_FORMAT_VERSION, 'animation');
  checkJson(input, '', issues);
  if (issues.some((issue) => issue.message.includes('accessor'))) return { issues };
  checkAnimationFields(input, issues);
  const parsed = animationClipSchema.safeParse(input);
  if (!parsed.success) return { issues: [...issues, ...shapeIssues(parsed.error)] };
  const clip = parsed.data;
  checkAnimationReferences(clip, rig, (issue) => issues.push(issue));
  return issues.length ? { issues } : { issues, data: clip };
}

/** Reports file, scalar, timeline and rig-reference errors. */
export function validateAnimationDefinition(input: unknown, rig: Rig | RigDefinition): ValidationIssue[] {
  return inspectAnimationDefinition(input, rig).issues;
}

/** Validate a versioned file and return an ordinary clip for AnimationPlayer.addAnimation. */
export function parseAnimationClip(input: unknown, rig: Rig | RigDefinition): AnimationClip {
  const { issues, data } = inspectAnimationDefinition(input, rig);
  if (!data) {
    if (isRecord(input) && Object.hasOwn(input, 'version') && input.version !== ANIMATION_FORMAT_VERSION)
      throw new UnsupportedFormatVersionError('animation', input.version, ANIMATION_FORMAT_VERSION);
    throw new AnimationValidationError(issues);
  }
  return data;
}
