import { z } from 'zod';
import type { AnimationClip } from './AnimationClip.js';
import {
  parseAnimationClip,
  parseRigDefinition,
  type RigJsonDefinition,
  type ValidationIssue,
  validateAnimationDefinition,
  validateRigDefinition,
} from './externalData.js';
import { type PoseDefinition, parsePoseDefinition } from './Pose.js';
import type { Rig } from './Rig.js';
import { skinDefinitionSchema } from './schemas.js';
import type { BoneDefinition, SkinDefinition } from './types.js';

export const CHARACTER_FORMAT_VERSION = 1;

const skinFileSchema = skinDefinitionSchema.strict();

export const characterManifestSchema = z.strictObject({
  version: z.literal(CHARACTER_FORMAT_VERSION),
  id: z.string().min(1),
  rig: z.string().min(1),
  defaultSkin: z.string().min(1),
  skins: z.record(z.string().min(1), z.string().min(1)),
  animations: z.array(z.string().min(1)),
  poses: z.array(z.string().min(1)).optional(),
  /** Phaser texture key -> image path, relative to character.json. */
  textures: z.record(z.string().min(1), z.string().min(1)),
});

export type CharacterManifest = z.infer<typeof characterManifestSchema>;

/** Parsed JSON files indexed by the paths used in character.json. */
export interface CharacterData {
  manifest: unknown;
  rig?: unknown;
  skins?: Readonly<Record<string, unknown>>;
  animations?: Readonly<Record<string, unknown>>;
  poses?: Readonly<Record<string, unknown>>;
}

function prefixed(issues: readonly ValidationIssue[], prefix: string): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, path: issue.path ? `${prefix}.${issue.path}` : prefix }));
}

function issue(path: string, message: string): ValidationIssue {
  return { severity: 'error', path, message };
}

function jsonIssue(value: unknown, path: string, seen: Set<object>, issues: ValidationIssue[]): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) {
    issues.push(issue(path, 'Must be a finite JSON value.'));
    return;
  }
  if (seen.has(value)) {
    issues.push(issue(path, 'Cyclic references are not allowed.'));
    return;
  }
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null &&
    !Array.isArray(value)
  ) {
    issues.push(issue(path, 'Must be a plain JSON object.'));
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) issues.push(issue(`${path}[${index}]`, 'Sparse arrays are not JSON data.'));
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key === 'symbol') {
      issues.push(issue(path, 'Symbol keys are not JSON data.'));
      continue;
    }
    const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      issues.push(issue(childPath, 'Hidden or accessor properties are not JSON data.'));
      continue;
    }
    jsonIssue(descriptor.value, childPath, seen, issues);
  }
  seen.delete(value);
}

/** Validates manifest shape, all files, and references across files. Requires no Phaser or I/O. */
export function validateCharacterDefinition(data: CharacterData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  jsonIssue(data.manifest, 'manifest', new Set(), issues);
  if (issues.length) return issues;
  const parsed = characterManifestSchema.safeParse(data.manifest);
  if (!parsed.success) {
    for (const entry of parsed.error.issues) {
      const path = entry.path.length ? `manifest.${entry.path.join('.')}` : 'manifest';
      issues.push(issue(path, entry.message));
    }
    return issues;
  }
  const manifest = parsed.data;
  if (data.rig === undefined) issues.push(issue('rig', `Missing rig file "${manifest.rig}".`));
  else issues.push(...prefixed(validateRigDefinition(data.rig), 'rig'));

  const skins: SkinDefinition[] = [];
  for (const [name, path] of Object.entries(manifest.skins)) {
    const value = data.skins?.[path];
    if (value === undefined) {
      issues.push(issue(`skins.${name}`, `Missing skin file "${path}".`));
      continue;
    }
    const previousIssueCount = issues.length;
    jsonIssue(value, `skins.${name}`, new Set(), issues);
    if (issues.length !== previousIssueCount) continue;
    const skin = skinFileSchema.safeParse(value);
    if (!skin.success) {
      for (const entry of skin.error.issues)
        issues.push(issue(`skins.${name}${entry.path.length ? `.${entry.path.join('.')}` : ''}`, entry.message));
      continue;
    }
    if (skin.data.name !== name) issues.push(issue(`skins.${name}.name`, `Skin name must be "${name}".`));
    skins.push(skin.data);
  }
  if (!Object.hasOwn(manifest.skins, manifest.defaultSkin))
    issues.push(issue('manifest.defaultSkin', `Unknown default skin "${manifest.defaultSkin}".`));

  const rigValid = data.rig !== undefined && validateRigDefinition(data.rig).length === 0;
  if (rigValid) {
    const combined = { ...(data.rig as object), skins };
    issues.push(
      ...prefixed(
        validateRigDefinition(combined).filter((entry) => entry.path?.startsWith('skins[')),
        'rig',
      ),
    );
    const rig = parseRigDefinition(data.rig);
    const textures = new Set(Object.keys(manifest.textures));
    const sourceBones = (data.rig as { bones: readonly BoneDefinition[] }).bones;
    for (const [index, bone] of sourceBones.entries())
      if (bone.sprite && !textures.has(bone.sprite.texture))
        issues.push(issue(`rig.bones[${index}].sprite.texture`, `Missing texture asset "${bone.sprite.texture}".`));
    for (const [index, attachment] of rig.attachments.entries())
      if (!textures.has(attachment.texture))
        issues.push(issue(`rig.attachments[${index}].texture`, `Missing texture asset "${attachment.texture}".`));
  }
  const names = new Set<string>();
  const rig = rigValid ? parseRigDefinition(data.rig) : undefined;
  for (const [index, path] of manifest.animations.entries()) {
    const value = data.animations?.[path];
    if (value === undefined) {
      issues.push(issue(`animations[${index}]`, `Missing animation file "${path}".`));
      continue;
    }
    if (rig) issues.push(...prefixed(validateAnimationDefinition(value, rig), `animations[${index}]`));
    if (typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string') {
      if (names.has(value.name))
        issues.push(issue(`animations[${index}].name`, `Duplicate animation name "${value.name}".`));
      names.add(value.name);
    }
  }
  const poseNames = new Set<string>();
  for (const [index, path] of (manifest.poses ?? []).entries()) {
    const value = data.poses?.[path];
    if (value === undefined) {
      issues.push(issue(`poses[${index}]`, `Missing pose file "${path}".`));
      continue;
    }
    if (!rig) continue;
    try {
      const pose = parsePoseDefinition(value, rig);
      if (poseNames.has(pose.name)) issues.push(issue(`poses[${index}].name`, `Duplicate pose name "${pose.name}".`));
      poseNames.add(pose.name);
    } catch (error) {
      issues.push(issue(`poses[${index}]`, error instanceof Error ? error.message : String(error)));
    }
  }
  return issues;
}

export class CharacterValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`Invalid character definition:\n${issues.map((entry) => `${entry.path}: ${entry.message}`).join('\n')}`);
    this.name = 'CharacterValidationError';
  }
}

/** Fully assembled runtime data. No fetch or Phaser dependency. */
export class CharacterDefinition {
  private constructor(
    readonly id: string,
    readonly rig: Rig,
    readonly animations: readonly AnimationClip[],
    readonly poses: readonly PoseDefinition[],
    readonly defaultSkin: string,
    readonly textures: Readonly<Record<string, string>>,
    readonly baseUrl?: string,
    readonly rigFile?: RigJsonDefinition,
    readonly rigPath?: string,
  ) {}

  static fromData(data: CharacterData, baseUrl?: string): CharacterDefinition {
    const issues = validateCharacterDefinition(data);
    if (issues.length) throw new CharacterValidationError(issues);
    const manifest = characterManifestSchema.parse(data.manifest);
    const source = data.rig as object;
    const skins = Object.entries(manifest.skins).map(([name, path]) => {
      const skin = skinFileSchema.parse(data.skins![path]);
      return { ...skin, name };
    });
    const rig = parseRigDefinition({ ...source, skins });
    const animations = manifest.animations.map((path) => parseAnimationClip(data.animations![path], rig));
    const poses = (manifest.poses ?? []).map((path) => parsePoseDefinition(data.poses![path], rig));
    return new CharacterDefinition(
      manifest.id,
      rig,
      animations,
      poses,
      manifest.defaultSkin,
      { ...manifest.textures },
      baseUrl,
      structuredClone(data.rig) as RigJsonDefinition,
      manifest.rig,
    );
  }

  textureUrl(key: string): string {
    const path = this.textures[key];
    if (!path) throw new Error(`Unknown character texture "${key}".`);
    return this.baseUrl ? new URL(path, this.baseUrl).href : path;
  }
}
