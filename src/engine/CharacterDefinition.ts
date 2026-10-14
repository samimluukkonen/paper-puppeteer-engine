import type { z } from 'zod';
import { type AnimationClip, type CompiledClip, compileValidatedClip } from './AnimationClip.js';
import {
  inspectAnimationDefinition,
  inspectRigDefinition,
  shapeIssues,
  type RigJsonDefinition,
  type ValidationIssue,
  validateSkinReferences,
} from './externalData.js';
import { checkJson } from './jsonData.js';
import { mergeSkins } from './mergeSkins.js';
import { inspectPoseDefinition, type PoseDefinition } from './Pose.js';
import { type DeepReadonly, freezeData } from './readonlyData.js';
import { Rig } from './Rig.js';
import { characterManifestSchema, skinFileSchema } from './schemas.js';
import type { SkinDefinition } from './types.js';

export { CHARACTER_FORMAT_VERSION, characterManifestSchema } from './schemas.js';

export type CharacterManifest = z.infer<typeof characterManifestSchema>;

/** Parsed JSON files indexed by the paths used in character.json. */
export interface CharacterData {
  manifest: unknown;
  rig?: unknown;
  skins?: Readonly<Record<string, unknown>>;
  animations?: Readonly<Record<string, unknown>>;
  poses?: Readonly<Record<string, unknown>>;
}

function prefixed(issues: readonly ValidationIssue[], prefix: string, document?: string): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path ? `${prefix}.${issue.path}` : prefix,
    message: document ? `${document}: ${issue.message}` : issue.message,
  }));
}

function issue(path: string, message: string): ValidationIssue {
  return { severity: 'error', path, message };
}

/** @internal Metadata documents have distinct roles; texture keys may share one image path. */
export function checkManifestReferences(manifest: CharacterManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Object.hasOwn(manifest.skins, manifest.defaultSkin))
    issues.push(issue('manifest.defaultSkin', `Unknown default skin "${manifest.defaultSkin}".`));
  const paths = new Map<string, string>();
  const references: [string, string][] = [
    ['manifest.rig', manifest.rig],
    ...Object.entries(manifest.skins).map(([name, path]): [string, string] => [`manifest.skins.${name}`, path]),
    ...manifest.animations.map((path, index): [string, string] => [`manifest.animations[${index}]`, path]),
    ...(manifest.poses ?? []).map((path, index): [string, string] => [`manifest.poses[${index}]`, path]),
  ];
  for (const [field, path] of references) {
    const previous = paths.get(path);
    if (previous) issues.push(issue(field, `Metadata path "${path}" is already used by ${previous}.`));
    else paths.set(path, field);
  }
  for (const [key, path] of Object.entries(manifest.textures))
    if (paths.has(path))
      issues.push(issue(`manifest.textures.${key}`, `Image path "${path}" is also a metadata document.`));
  return issues;
}

interface CharacterInspection {
  issues: ValidationIssue[];
  manifest?: CharacterManifest;
  rig?: Rig;
  animations: AnimationClip[];
  poses: PoseDefinition[];
  skins: SkinDefinition[];
}

function inspectCharacterDefinition(data: CharacterData): CharacterInspection {
  const issues: ValidationIssue[] = [];
  const result: CharacterInspection = { issues, animations: [], poses: [], skins: [] };
  checkJson(data.manifest, 'manifest', issues);
  if (issues.length) return result;
  const parsed = characterManifestSchema.safeParse(data.manifest);
  if (!parsed.success) {
    issues.push(...prefixed(shapeIssues(parsed.error), 'manifest'));
    return result;
  }
  const manifest = parsed.data;
  issues.push(...checkManifestReferences(manifest));
  result.manifest = manifest;
  if (data.rig === undefined) issues.push(issue('rig', `Missing rig file "${manifest.rig}".`));
  const source = data.rig === undefined ? undefined : inspectRigDefinition(data.rig);
  if (source) issues.push(...prefixed(source.issues, 'rig', manifest.rig));

  const skins = result.skins;
  const skinPaths: string[] = [];
  const skinDocuments: string[] = [];
  for (const [name, path] of Object.entries(manifest.skins)) {
    const value = data.skins && Object.hasOwn(data.skins, path) ? data.skins[path] : undefined;
    if (value === undefined) {
      issues.push(issue(`skins.${name}`, `Missing skin file "${path}".`));
      continue;
    }
    const previousIssueCount = issues.length;
    checkJson(value, `skins.${name}`, issues);
    if (issues.length !== previousIssueCount) continue;
    const skin = skinFileSchema.safeParse(value);
    if (!skin.success) {
      issues.push(...prefixed(shapeIssues(skin.error), `skins.${name}`, path));
      continue;
    }
    if (skin.data.name !== name) issues.push(issue(`skins.${name}.name`, `Skin name must be "${name}".`));
    skinPaths.push(`skins.${name}`);
    skinDocuments.push(path);
    skins.push(skin.data);
  }

  if (source?.data) {
    const skinIssues = validateSkinReferences(skins, source.data);
    // Semantic validation indexes only successfully parsed files, not the full manifest list.
    for (const entry of skinIssues) {
      const path = entry.path?.replace(
        /^skins\[(\d+)\]/,
        (prefix, index: string) => skinPaths[Number(index)] ?? prefix,
      );
      const index = Number(entry.path?.match(/^skins\[(\d+)\]/)?.[1]);
      const document = skinDocuments[index];
      issues.push({
        ...entry,
        ...(path === undefined ? {} : { path }),
        message: document ? `${document}: ${entry.message}` : entry.message,
      });
    }
    // Keep checking clips and poses when standalone skins have broken references.
    result.rig = new Rig({
      ...source.data,
      skins: mergeSkins(source.data.skins ?? [], skinIssues.length ? [] : skins),
    });
    const textures = new Set(Object.keys(manifest.textures));
    for (const [index, bone] of source.data.bones.entries())
      if (bone.sprite && !textures.has(bone.sprite.texture))
        issues.push(
          issue(
            `rig.bones[${index}].sprite.texture`,
            `${manifest.rig}: Missing texture asset "${bone.sprite.texture}".`,
          ),
        );
    for (const [index, attachment] of result.rig.attachments.entries())
      if (!textures.has(attachment.texture))
        issues.push(
          issue(`rig.attachments[${index}].texture`, `${manifest.rig}: Missing texture asset "${attachment.texture}".`),
        );
  }
  const names = new Set<string>();
  const rig = result.rig;
  for (const [index, path] of manifest.animations.entries()) {
    const value = data.animations && Object.hasOwn(data.animations, path) ? data.animations[path] : undefined;
    if (value === undefined) {
      issues.push(issue(`animations[${index}]`, `Missing animation file "${path}".`));
      continue;
    }
    const clip = inspectAnimationDefinition(value, rig);
    issues.push(...prefixed(clip.issues, `animations[${index}]`, path));
    if (clip.data) result.animations.push(clip.data);
    const name: unknown =
      typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'name')?.value : undefined;
    if (typeof name === 'string') {
      if (names.has(name)) issues.push(issue(`animations[${index}].name`, `Duplicate animation name "${name}".`));
      names.add(name);
    }
  }
  const poseNames = new Set<string>();
  for (const [index, path] of (manifest.poses ?? []).entries()) {
    const value = data.poses && Object.hasOwn(data.poses, path) ? data.poses[path] : undefined;
    if (value === undefined) {
      issues.push(issue(`poses[${index}]`, `Missing pose file "${path}".`));
      continue;
    }
    const pose = inspectPoseDefinition(value, rig);
    issues.push(...prefixed(pose.issues, `poses[${index}]`, path));
    if (pose.data) {
      result.poses.push(pose.data);
      if (poseNames.has(pose.data.name))
        issues.push(issue(`poses[${index}].name`, `Duplicate pose name "${pose.data.name}".`));
      poseNames.add(pose.data.name);
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

// Definitions are frozen; keep lazy compiler data outside their authored JSON snapshot.
const compiledAnimations = new WeakMap<CharacterDefinition, readonly CompiledClip[]>();

/** Fully assembled immutable runtime data. Clone JSON data before authoring changes. */
export class CharacterDefinition {
  private constructor(
    readonly id: string,
    readonly rig: Rig,
    readonly animations: DeepReadonly<readonly AnimationClip[]>,
    readonly poses: DeepReadonly<readonly PoseDefinition[]>,
    readonly defaultSkin: string,
    readonly textures: Readonly<Record<string, string>>,
    /** Manifest-owned skins, retained separately from the authored rig for editor previews. */
    readonly standaloneSkins: DeepReadonly<readonly SkinDefinition[]>,
    /** Clip name -> original manifest path, retained for authoring exports. */
    readonly animationPaths: Readonly<Record<string, string>>,
    readonly baseUrl?: string,
    readonly rigFile?: DeepReadonly<RigJsonDefinition>,
    readonly rigPath?: string,
    /** Original relative paths retained for complete package round trips. */
    readonly manifest?: DeepReadonly<CharacterManifest>,
  ) {}

  /** Immutable clips compiled once per character; players retain their own clocks and pose buffers. */
  get compiledAnimations(): readonly CompiledClip[] {
    let clips = compiledAnimations.get(this);
    if (!clips) {
      // Assembly already validated and froze these rig-specific snapshots. Preserve
      // their track identities for the compiler's immutable property caches.
      clips = Object.freeze(this.animations.map((clip) => compileValidatedClip(clip)));
      compiledAnimations.set(this, clips);
    }
    return clips;
  }

  static fromData(data: CharacterData, baseUrl?: string): CharacterDefinition {
    const { issues, manifest, rig, animations, poses, skins } = inspectCharacterDefinition(data);
    if (issues.length || !manifest || !rig) throw new CharacterValidationError(issues);
    return Object.freeze(
      new CharacterDefinition(
        manifest.id,
        rig,
        freezeData(animations),
        freezeData(poses),
        manifest.defaultSkin,
        freezeData({ ...manifest.textures }),
        freezeData(skins),
        freezeData(Object.fromEntries(animations.map((clip, index) => [clip.name, manifest.animations[index]!]))),
        baseUrl,
        freezeData(structuredClone(data.rig) as RigJsonDefinition),
        manifest.rig,
        freezeData(structuredClone(manifest)),
      ),
    );
  }

  textureUrl(key: string): string {
    if (!Object.hasOwn(this.textures, key)) throw new Error(`Unknown character texture "${key}".`);
    const path = this.textures[key]!;
    return this.baseUrl ? new URL(path, this.baseUrl).href : path;
  }
}
