import { z } from 'zod';
import type { AnimationClip } from './AnimationClip.js';
import {
  checkJson,
  inspectAnimationDefinition,
  inspectRigDefinition,
  type RigJsonDefinition,
  type ValidationIssue,
  validateSkinReferences,
} from './externalData.js';
import { type PoseDefinition, parsePoseDefinition } from './Pose.js';
import { Rig } from './Rig.js';
import { skinDefinitionSchema } from './schemas.js';
import type { SkinDefinition } from './types.js';

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

interface CharacterInspection {
  issues: ValidationIssue[];
  manifest?: CharacterManifest;
  rig?: Rig;
  animations: AnimationClip[];
  poses: PoseDefinition[];
}

function inspectCharacterDefinition(data: CharacterData): CharacterInspection {
  const issues: ValidationIssue[] = [];
  const result: CharacterInspection = { issues, animations: [], poses: [] };
  checkJson(data.manifest, 'manifest', issues);
  if (issues.length) return result;
  const parsed = characterManifestSchema.safeParse(data.manifest);
  if (!parsed.success) {
    for (const entry of parsed.error.issues) {
      const path = entry.path.length ? `manifest.${entry.path.join('.')}` : 'manifest';
      issues.push(issue(path, entry.message));
    }
    return result;
  }
  const manifest = parsed.data;
  result.manifest = manifest;
  if (data.rig === undefined) issues.push(issue('rig', `Missing rig file "${manifest.rig}".`));
  const source = data.rig === undefined ? undefined : inspectRigDefinition(data.rig);
  if (source) issues.push(...prefixed(source.issues, 'rig'));

  const skins: SkinDefinition[] = [];
  for (const [name, path] of Object.entries(manifest.skins)) {
    const value = data.skins?.[path];
    if (value === undefined) {
      issues.push(issue(`skins.${name}`, `Missing skin file "${path}".`));
      continue;
    }
    const previousIssueCount = issues.length;
    checkJson(value, `skins.${name}`, issues);
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

  if (source?.data) {
    const skinIssues = validateSkinReferences(skins, source.data);
    issues.push(...prefixed(skinIssues, 'rig'));
    // Keep checking clips and poses when standalone skins have broken references.
    result.rig = new Rig({ ...source.data, skins: skinIssues.length ? [] : skins });
    const textures = new Set(Object.keys(manifest.textures));
    for (const [index, bone] of source.data.bones.entries())
      if (bone.sprite && !textures.has(bone.sprite.texture))
        issues.push(issue(`rig.bones[${index}].sprite.texture`, `Missing texture asset "${bone.sprite.texture}".`));
    for (const [index, attachment] of result.rig.attachments.entries())
      if (!textures.has(attachment.texture))
        issues.push(issue(`rig.attachments[${index}].texture`, `Missing texture asset "${attachment.texture}".`));
  }
  const names = new Set<string>();
  const rig = result.rig;
  for (const [index, path] of manifest.animations.entries()) {
    const value = data.animations?.[path];
    if (value === undefined) {
      issues.push(issue(`animations[${index}]`, `Missing animation file "${path}".`));
      continue;
    }
    if (rig) {
      const clip = inspectAnimationDefinition(value, rig);
      issues.push(...prefixed(clip.issues, `animations[${index}]`));
      if (clip.data) result.animations.push(clip.data);
    }
    const name =
      typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'name')?.value : undefined;
    if (typeof name === 'string') {
      if (names.has(name)) issues.push(issue(`animations[${index}].name`, `Duplicate animation name "${name}".`));
      names.add(name);
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
      result.poses.push(pose);
      if (poseNames.has(pose.name)) issues.push(issue(`poses[${index}].name`, `Duplicate pose name "${pose.name}".`));
      poseNames.add(pose.name);
    } catch (error) {
      issues.push(issue(`poses[${index}]`, error instanceof Error ? error.message : String(error)));
    }
  }
  return result;
}

/** Validates manifest shape, all files, and references across files. Requires no Phaser or I/O. */
export function validateCharacterDefinition(data: CharacterData): ValidationIssue[] {
  return inspectCharacterDefinition(data).issues;
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
    const { issues, manifest, rig, animations, poses } = inspectCharacterDefinition(data);
    if (issues.length || !manifest || !rig) throw new CharacterValidationError(issues);
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
