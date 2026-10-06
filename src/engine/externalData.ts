import type { z } from 'zod';
import type { AnimationClip } from './AnimationClip.js';
import type { JsonValue } from './jsonData.js';
import { checkJson, childPath } from './jsonData.js';
import { Rig } from './Rig.js';
import {
  ANIMATION_FORMAT_VERSION,
  animationClipSchema,
  animationFileSchema,
  RIG_FORMAT_VERSION,
  rigDefinitionSchema,
  rigFileSchema,
} from './schemas.js';
import type { RigDefinition, SkinDefinition } from './types.js';
import {
  checkAnimationReferences,
  checkRigReferences,
  checkSkinReferences,
  type ValidationIssue,
} from './validation.js';

export type { JsonValue } from './jsonData.js';
export { checkJson } from './jsonData.js';
export { ANIMATION_FORMAT_VERSION, RIG_FORMAT_VERSION } from './schemas.js';

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
    super(
      // oxlint-disable-next-line typescript/no-base-to-string -- Deliberately render every unknown version in validation diagnostics.
      `Unsupported ${format} format version ${typeof version === 'object' ? JSON.stringify(version) : String(version)}; supported version is ${supportedVersion}.`,
    );
    this.name = 'UnsupportedFormatVersionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @internal Convert schema diagnostics to the shared field-path format. */
export function shapeIssues(error: {
  issues: readonly { path: PropertyKey[]; message: string; code?: string; keys?: readonly string[] }[];
}): ValidationIssue[] {
  return error.issues.flatMap((issue): ValidationIssue[] => {
    const path = issue.path.reduce<string>((base, key) => childPath(base, key as string | number), '');
    return issue.code === 'unrecognized_keys' && issue.keys
      ? issue.keys.map((key) => ({ severity: 'error', path: childPath(path, key), message: `Unknown field "${key}".` }))
      : [{ severity: 'error', path, message: issue.message }];
  });
}

/** @internal Inspect only owned JSON version metadata, without invoking accessors. */
export function inspectVersion(input: unknown, expected: number, format: 'rig' | 'animation' | 'skin' | 'pose') {
  const descriptor = isRecord(input) ? Object.getOwnPropertyDescriptor(input, 'version') : undefined;
  if (!descriptor)
    return {
      issues: [{ severity: 'error' as const, path: 'version', message: `${format} format version is required.` }],
    };
  if (descriptor.value !== expected) {
    const versionError = new UnsupportedFormatVersionError(format, descriptor.value, expected);
    return { issues: [{ severity: 'error' as const, path: 'version', message: versionError.message }], versionError };
  }
  return { issues: [] };
}

// Strict file schemas are the authority for nested fields. Strip file metadata
// from successful parses so callers receive the same runtime data as before.
const rigFileDataSchema = rigFileSchema.transform(({ version: _version, name: _name, ...data }) => data);
const animationFileDataSchema = animationFileSchema.transform(({ version: _version, ...data }) => data);

function inspectFileShape<Definition>(
  input: unknown,
  fileSchema: z.ZodType<Definition>,
  runtimeSchema: z.ZodType<Definition>,
  issues: ValidationIssue[],
): Definition | undefined {
  const file = fileSchema.safeParse(input);
  if (file.success) return file.data;
  for (const issue of file.error.issues) {
    if (issue.code !== 'unrecognized_keys') continue;
    const path = issue.path.reduce<string>((base, key) => childPath(base, key as string | number), '');
    for (const key of issue.keys)
      issues.push({ severity: 'error', path: childPath(path, key), message: `Unknown field "${key}".` });
  }
  // Runtime schemas strip unknown fields, allowing reference/timeline diagnostics
  // to accompany strict-file errors. They retain the shared scalar constraints.
  const runtime = runtimeSchema.safeParse(input);
  if (!runtime.success) {
    issues.push(...shapeIssues(runtime.error));
    return undefined;
  }
  return runtime.data;
}

/** @internal Shared inspection result; parsers retain typed version errors. */
export interface ValidationResult<T> {
  issues: ValidationIssue[];
  data?: T;
  versionError?: UnsupportedFormatVersionError | undefined;
}

/** @internal Retains validated data so character assembly need not parse the file again. */
export function inspectRigDefinition(input: unknown): ValidationResult<RigDefinition> {
  const issues: ValidationIssue[] = [];
  if (!checkJson(input, '', issues)) return { issues };
  const { issues: versionIssues, versionError } = inspectVersion(input, RIG_FORMAT_VERSION, 'rig');
  issues.push(...versionIssues);
  const data = inspectFileShape<RigDefinition>(input, rigFileDataSchema, rigDefinitionSchema, issues);
  if (!data) return { issues, versionError };
  if (isRecord(input) && input.name !== undefined) {
    const name = rigFileSchema.shape.name.safeParse(input.name);
    if (!name.success) issues.push(...shapeIssues(name.error).map((issue) => ({ ...issue, path: 'name' })));
  }
  checkRigReferences(data, (issue) => issues.push(issue));
  return issues.length ? { issues, versionError } : { issues, data };
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
  const { issues, data, versionError } = inspectRigDefinition(input);
  if (!data) {
    if (versionError) throw versionError;
    throw new RigValidationError(issues);
  }
  return new Rig(data);
}

/** @internal Inspect files and timelines independently; check bone references when a valid rig is available. */
export function inspectAnimationDefinition(input: unknown, rig?: Rig | RigDefinition): ValidationResult<AnimationClip> {
  const issues: ValidationIssue[] = [];
  if (!checkJson(input, '', issues)) return { issues };
  const { issues: versionIssues, versionError } = inspectVersion(input, ANIMATION_FORMAT_VERSION, 'animation');
  issues.push(...versionIssues);
  const clip = inspectFileShape<AnimationClip>(input, animationFileDataSchema, animationClipSchema, issues);
  if (!clip) return { issues, versionError };
  checkAnimationReferences(clip, rig, (issue) => issues.push(issue));
  return issues.length ? { issues, versionError } : { issues, data: structuredClone(clip) };
}

/** Reports file, scalar, timeline and rig-reference errors. */
export function validateAnimationDefinition(input: unknown, rig: Rig | RigDefinition): ValidationIssue[] {
  if (!rig) throw new Error('Animation validation requires a rig.');
  return inspectAnimationDefinition(input, rig).issues;
}

/** Validate a versioned file and return an ordinary clip for AnimationPlayer.addAnimation. */
export function parseAnimationClip(input: unknown, rig: Rig | RigDefinition): AnimationClip {
  if (!rig) throw new Error('Animation parsing requires a rig.');
  const { issues, data, versionError } = inspectAnimationDefinition(input, rig);
  if (!data) {
    if (versionError) throw versionError;
    throw new AnimationValidationError(issues);
  }
  return data;
}
