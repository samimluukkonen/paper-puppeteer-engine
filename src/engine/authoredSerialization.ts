import { CharacterValidationError, characterManifestSchema, checkManifestReferences } from './CharacterDefinition.js';
import {
  AnimationValidationError,
  inspectAnimationDefinition,
  inspectRigDefinition,
  RigValidationError,
  shapeIssues,
  validateSkinReferences,
  type ValidationIssue,
} from './externalData.js';
import { checkJson } from './jsonData.js';
import { assertJsonInputSize } from './jsonInput.js';
import type { Rig } from './Rig.js';
import { skinFileSchema } from './schemas.js';
import type { RigDefinition } from './types.js';

/** @internal Canonical object keys, exact numbers and authored array order. Never projects runtime objects. */
export function canonicalJson(input: unknown): string {
  const issues: ValidationIssue[] = [];
  checkJson(input, '', issues);
  if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  const json = `${JSON.stringify(
    input,
    (_key, value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    },
    2,
  )}\n`;
  assertJsonInputSize(json);
  return json;
}

/** Serialize a versioned authored rig, retaining name metadata and omitted defaults. */
export function serializeRigDefinition(input: unknown): string {
  const result = inspectRigDefinition(input);
  if (!result.data) throw result.versionError ?? new RigValidationError(result.issues);
  return canonicalJson(input);
}

/** Serialize a versioned authored clip without rounding times, transforms, IK or event payloads. */
export function serializeAnimationDefinition(input: unknown, rig: Rig | RigDefinition): string {
  if (!rig) throw new Error('Animation serialization requires a rig.');
  const result = inspectAnimationDefinition(input, rig);
  if (!result.data) throw result.versionError ?? new AnimationValidationError(result.issues);
  return canonicalJson(input);
}

/** Validate both standalone skin fields and its slot/attachment references before writing. */
export function serializeSkinDefinition(input: unknown, rig: Rig | RigDefinition): string {
  if (!rig) throw new Error('Skin serialization requires a rig.');
  const issues: ValidationIssue[] = [];
  if (checkJson(input, '', issues)) {
    const parsed = skinFileSchema.safeParse(input);
    if (parsed.success) issues.push(...validateSkinReferences([parsed.data], rig));
    else issues.push(...shapeIssues(parsed.error));
  }
  if (issues.length) throw new RigValidationError(issues);
  return canonicalJson(input);
}

/** Validate manifest fields; use validateCharacterDefinition/validatePackage for resource resolution. */
export function serializeCharacterManifest(input: unknown): string {
  const issues: ValidationIssue[] = [];
  if (checkJson(input, 'manifest', issues)) {
    const parsed = characterManifestSchema.safeParse(input);
    if (!parsed.success)
      issues.push(
        ...shapeIssues(parsed.error).map((issue) => ({
          ...issue,
          path: issue.path ? `manifest.${issue.path}` : 'manifest',
        })),
      );
    else issues.push(...checkManifestReferences(parsed.data));
  }
  if (issues.length) throw new CharacterValidationError(issues);
  return canonicalJson(input);
}
