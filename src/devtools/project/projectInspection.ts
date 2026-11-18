import {
  validateAudioAssetData,
  canonicalJson,
  validateCharacterDefinition,
  shapeIssues,
  IMAGE_HEADER_BYTES,
  assertMeshImageSize,
  packagePath,
  validatePackageFiles,
  validateRigBoneMapping,
  sceneDefinitionSchema,
  validateSceneDefinition,
  validateStoryDefinition,
  type CharacterManifest,
  type SceneCharacterAssets,
} from '../../engine/core.js';
import type { ValidationIssue } from '../../engine/data.js';
import { CharacterTextureBudget } from '../../engine/runtime.js';
import { inspectSpriteHeader } from '../shared/artwork/spriteImport.js';
import type { PackageFiles, PackageSnapshot } from '../shared/package/characterPackage.js';
import { PackageFingerprints } from '../shared/package/PackageFingerprints.js';
import { parseProjectDefinition } from './ProjectDefinition.js';

export type ValidationContext = 'draft' | 'export';
export type AssetKind =
  | 'project'
  | 'story'
  | 'rig-mapping'
  | 'audio'
  | 'character'
  | 'rig'
  | 'bone'
  | 'ik'
  | 'slot'
  | 'skin'
  | 'attachment'
  | 'texture'
  | 'animation'
  | 'pose'
  | 'scene'
  | 'actor'
  | 'action'
  | 'dialogue';
/** Names are scoped by character or scene, never treated as globally unique. */
export interface AssetReference {
  readonly kind: AssetKind;
  readonly owner: string;
  readonly id: string;
}
export interface AssetDependency {
  readonly from: AssetReference;
  readonly to: AssetReference;
  readonly label: string;
}
export interface ProjectDiagnostic {
  readonly severity: 'error' | 'warning' | 'information';
  readonly asset: AssetReference;
  readonly path: string;
  readonly message: string;
  readonly advice: string;
  readonly view: 'project' | 'rig' | 'animation' | 'scene';
}
export interface InspectionCharacter {
  readonly snapshot?: PackageSnapshot;
  readonly files: PackageFiles;
  readonly unavailable?: string;
}
export interface ProjectInspectionInput {
  readonly definition: unknown;
  readonly characters: ReadonlyMap<string, InspectionCharacter>;
  readonly scenes: ReadonlyMap<string, unknown>;
  readonly audio?: ReadonlyMap<string, Uint8Array>;
}
export interface ProjectInspection {
  readonly context: ValidationContext;
  readonly issues: readonly ProjectDiagnostic[];
  readonly dependencies: readonly AssetDependency[];
  readonly counts: Readonly<Record<ProjectDiagnostic['severity'], number>>;
  readonly checked: { readonly characters: number; readonly scenes: number };
}
const asset = (kind: AssetKind, owner: string, id = owner): AssetReference => ({ kind, owner, id });
export const sameAsset = (a: AssetReference, b: AssetReference): boolean =>
  a.kind === b.kind && a.owner === b.owner && a.id === b.id;
export function assetDependents(report: ProjectInspection, target: AssetReference): readonly AssetDependency[] {
  return report.dependencies.filter(({ to }) => sameAsset(to, target));
}

export class ProjectValidationError extends Error {
  constructor(readonly report: ProjectInspection) {
    super(
      `Export blocked. ${report.issues
        .filter(({ severity }) => severity === 'error')
        .map(({ message }) => message)
        .join('\n')}`,
    );
    this.name = 'ProjectValidationError';
  }
}
export function requireValidExport(report: ProjectInspection): void {
  if (report.context !== 'export') throw new Error('Run production export validation before exporting.');
  if (report.counts.error) throw new ProjectValidationError(report);
}

/** Preserve final exporter diagnostics too (decoding, budgets, replacement proposals). */
export function packageExportFailure(
  report: ProjectInspection,
  target: AssetReference,
  error: unknown,
): ProjectValidationError {
  const issue: ProjectDiagnostic = {
    asset: target,
    severity: 'error',
    path: 'package',
    view: target.kind === 'project' ? 'project' : target.kind === 'scene' ? 'scene' : 'rig',
    message: `${target.kind === 'project' ? 'Project' : target.kind === 'scene' ? 'Scene' : 'Character'} "${target.id}": ${error instanceof Error ? error.message : String(error)}`,
    advice:
      target.kind === 'project'
        ? 'Review the project registrations and package limits, or export individual scene packages.'
        : 'Correct the package problem in the affected editor and export again.',
  };
  return new ProjectValidationError({
    ...report,
    issues: [...report.issues, issue],
    counts: { ...report.counts, error: report.counts.error + 1 },
  });
}

/** Inspection uses the same generated-document semantics as the character exporter.
 * Synthetic metadata paths preserve every authored clip/skin, including duplicates. */
function characterData(snapshot: PackageSnapshot) {
  const source = snapshot.definition.manifest;
  if (!source) throw new Error('Character has no source manifest.');
  const paths = [
    source.rig,
    ...Object.values(source.skins),
    ...source.animations,
    ...(source.poses ?? []),
    ...Object.values(source.textures),
  ].map((path) => path.toLowerCase());
  let directory = '__inspection';
  let serial = 0;
  while (
    paths.some((path) => path === directory || path.startsWith(`${directory}/`) || directory.startsWith(`${path}/`))
  )
    directory = `__inspection_${++serial}`;
  const skinPath = (index: number) => `${directory}/skins/inspection-${index}.json`;
  const animationPath = (index: number) => `${directory}/animations/inspection-${index}.json`;
  const posePath = (index: number) => `${directory}/poses/inspection-${index}.json`;
  const workingPoses = snapshot.poses ?? snapshot.definition.poses;
  const labels = new Map([
    ...snapshot.skins.map((skin, index) => [skinPath(index), `Skin "${skin.name}"`] as const),
    ...snapshot.animations.map((clip, index) => [animationPath(index), `Animation "${clip.name}"`] as const),
    ...workingPoses.map((pose, index) => [posePath(index), `Pose "${pose.name}"`] as const),
  ]);
  const manifest: CharacterManifest = {
    ...structuredClone(source),
    ...snapshot.identity,
    poses: workingPoses.map((_, index) => posePath(index)),
    skins: Object.fromEntries(snapshot.skins.map((skin, index) => [skin.name, skinPath(index)])),
    animations: snapshot.animations.map((_, index) => animationPath(index)),
    textures: { ...source.textures },
  };
  for (const [index, replacement] of snapshot.replacements.entries())
    if (replacement.newAsset && !replacement.reference)
      manifest.textures[replacement.assetKey] ??= `${directory}/images/inspection-${index}.png`;
  return {
    labels,
    data: {
      manifest,
      rig: snapshot.rig,
      skins: Object.fromEntries(snapshot.skins.map((skin, index) => [skinPath(index), skin])),
      animations: Object.fromEntries(
        snapshot.animations.map((clip, index) => [animationPath(index), { ...clip, version: 1 }]),
      ),
      poses: Object.fromEntries(workingPoses.map((pose, index) => [posePath(index), pose])),
    },
  };
}

/** No I/O or authored mutations. Cache semantic checks per character and scene; artwork
 * availability is always checked afresh. Explicit validation can discard all caches. */
export class ProjectInspector {
  private readonly characters = new Map<
    string,
    { key: string; issues: readonly ValidationIssue[]; fingerprints: PackageFingerprints }
  >();
  private readonly scenes = new Map<string, { key: string; issues: readonly ValidationIssue[] }>();
  retainAssets(characters: ReadonlySet<string>, scenes: ReadonlySet<string>): void {
    for (const id of this.characters.keys()) if (!characters.has(id)) this.characters.delete(id);
    for (const id of this.scenes.keys()) if (!scenes.has(id)) this.scenes.delete(id);
  }
  inspect(input: ProjectInspectionInput, context: ValidationContext = 'draft', fresh = false): ProjectInspection {
    if (fresh) {
      this.characters.clear();
      this.scenes.clear();
    }
    const issues: ProjectDiagnostic[] = [];
    const dependencies: AssetDependency[] = [];
    const checked = { characters: 0, scenes: 0 };
    const add = (
      target: AssetReference,
      message: string,
      path = '',
      severity: ProjectDiagnostic['severity'] = 'error',
      view: ProjectDiagnostic['view'] = 'project',
      advice = 'Open the affected asset and correct this reference, then revalidate.',
    ): void => {
      issues.push({ asset: target, path, severity, view, message, advice });
    };
    const finish = (): ProjectInspection => ({
      context,
      issues,
      dependencies,
      checked,
      counts: {
        error: issues.filter((issue) => issue.severity === 'error').length,
        warning: issues.filter((issue) => issue.severity === 'warning').length,
        information: issues.filter((issue) => issue.severity === 'information').length,
      },
    });
    const attempt = (target: AssetReference, run: () => void, view: ProjectDiagnostic['view'] = 'project'): void => {
      try {
        run();
      } catch (error) {
        add(target, error instanceof Error ? error.message : String(error), '', 'error', view);
      }
    };
    let project;
    try {
      project = parseProjectDefinition(input.definition);
    } catch (error) {
      if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
        // The existing parser owns both schema and package-path rules.
        for (const issue of shapeIssues(error as Parameters<typeof shapeIssues>[0]))
          add(asset('project', ''), issue.message, issue.path);
      } else add(asset('project', ''), error instanceof Error ? error.message : String(error));
      return finish();
    }
    const edge = (from: AssetReference, to: AssetReference, label: string): void => {
      dependencies.push({ from, to, label });
    };
    const catalog = new Map<string, SceneCharacterAssets>();
    for (const entry of project.audio ?? []) {
      const target = asset('audio', project.id, entry.id);
      edge(asset('project', project.id), target, `Project "${project.name}" audio library`);
      attempt(target, () => {
        const bytes = input.audio?.get(entry.id);
        if (!bytes) throw new Error(`Missing audio binary "${entry.path}". Reimport the original audio file.`);
        validateAudioAssetData(entry, bytes);
      });
    }
    const referenceIds = new Map(project.characters.map((entry) => [entry.manifest, entry.id]));
    for (const entry of project.characters) {
      const target = asset('character', entry.id);
      edge(asset('project', project.id), target, `Project "${project.name}"`);
      if (entry.variant) {
        const label = `Variant "${entry.name}" (shared rig and animations)`;
        edge(target, asset('character', entry.variant.rig), label);
        edge(target, asset('rig', entry.variant.rig), label);
        edge(
          target,
          asset('skin', entry.variant.rig, entry.variant.skin),
          `Variant "${entry.name}" selected appearance`,
        );
      }
      const character = input.characters.get(entry.id);
      const snapshot = character?.snapshot;
      if (!snapshot || !character) {
        add(
          target,
          `Character "${entry.name}": ${character?.unavailable ?? 'Working document is missing.'}`,
          '',
          'error',
          'rig',
        );
        continue;
      }
      const { rig, skins, animations, definition, replacements } = snapshot;
      if (entry.variant) {
        const label = `Variant "${entry.name}" shared assets`;
        for (const clip of animations) edge(target, asset('animation', entry.variant.rig, clip.name), label);
        for (const key of Object.keys(definition.textures))
          edge(target, asset('texture', entry.variant.rig, key), label);
      }
      catalog.set(entry.manifest, {
        animations: animations.map((clip) => clip.name),
        rootMotionAnimations: animations
          .filter((clip) => clip.rootMotion?.translationKeys.length)
          .map((clip) => clip.name),
        skins: [...skins, ...(rig.skins ?? [])].map((skin) => skin.name),
      });
      attempt(
        target,
        () => {
          const fingerprints = this.characters.get(entry.id)?.fingerprints ?? new PackageFingerprints();
          const key = canonicalJson([fingerprints.compute(snapshot), definition.manifest, definition.poses]);
          let cached = this.characters.get(entry.id);
          if (cached?.key !== key) {
            checked.characters++;
            const { data, labels } = characterData(snapshot);
            const issues = validateCharacterDefinition(data).map((issue) => ({
              ...issue,
              message: [...labels].reduce(
                (message, [path, label]) => message.replaceAll(path, () => label),
                issue.message,
              ),
            }));
            cached = { key, fingerprints, issues };
            this.characters.set(entry.id, cached);
          }
          for (const issue of cached.issues) {
            const view = issue.path?.startsWith('animations') ? 'animation' : 'rig';
            const index = issue.path?.match(/^animations\[(\d+)\]/)?.[1];
            const clip = index === undefined ? undefined : animations[Number(index)];
            add(
              clip ? asset('animation', entry.id, clip.name) : target,
              `Character "${entry.name}": ${issue.message}`,
              issue.path,
              issue.severity,
              view,
            );
          }
          const names = new Set<string>();
          for (const skin of skins) {
            if (names.has(skin.name))
              add(
                target,
                `Character "${entry.name}": Duplicate standalone skin "${skin.name}".`,
                'skins',
                'error',
                'rig',
              );
            names.add(skin.name);
          }
          if ((snapshot.identity?.id ?? definition.id) !== entry.id)
            add(
              target,
              `Character "${entry.name}" has a different ID from its project registration.`,
              'id',
              'error',
              'rig',
            );
          if (snapshot.pendingArtwork)
            add(
              target,
              `Character "${entry.name}": Apply or cancel the artwork proposal before exporting.`,
              'artwork',
              'error',
              'rig',
            );
          if (definition.manifest) {
            for (const path of [
              definition.manifest.rig,
              ...Object.values(definition.manifest.skins),
              ...definition.manifest.animations,
              ...(definition.manifest.poses ?? []),
              ...Object.values(definition.manifest.textures),
            ])
              attempt(
                target,
                () => {
                  packagePath(path);
                },
                'rig',
              );
          }
          attempt(target, () => validatePackageFiles(character.files), 'rig');
          const budget = new CharacterTextureBudget({ allowWebp: true });
          for (const [key, path] of Object.entries(definition.textures)) {
            edge(target, asset('texture', entry.id, key), `Character "${entry.name}" image library`);
            if (replacements.some((replacement) => replacement.assetKey === key && !replacement.reference)) continue;
            const bytes = character.files.get(path);
            if (!bytes)
              add(
                target,
                `Character "${entry.name}": Missing image "${path}" (texture "${key}").`,
                `textures.${key}`,
                context === 'export' ? 'error' : 'warning',
                'rig',
                'Import the missing image or replace its uses in the Rig Editor. Draft editing can continue.',
              );
            else
              attempt(
                target,
                () => {
                  const header = inspectSpriteHeader(bytes.subarray(0, IMAGE_HEADER_BYTES));
                  for (const attachment of rig.attachments ?? [])
                    if (attachment.type === 'mesh' && attachment.texture === key)
                      assertMeshImageSize(attachment, header);
                  budget.checkImage(key, bytes);
                },
                'rig',
              );
          }
        },
        'rig',
      );
      const rigAsset = asset('rig', entry.id);
      edge(target, rigAsset, `Character "${entry.name}"`);
      const bone = (id: string) => asset('bone', entry.id, id);
      const ik = (id: string) => asset('ik', entry.id, id);
      const sprite = (
        from: AssetReference,
        value: { texture: string; frame?: string | number },
        label: string,
      ): void => {
        edge(from, asset('texture', entry.id, value.texture), label);
        if (value.frame !== undefined && value.frame !== '__BASE')
          add(
            target,
            `${label} uses image frame "${value.frame}". Packages contain static images.`,
            'frame',
            context === 'export' ? 'error' : 'warning',
            'rig',
            'Resolve the atlas frame to a separate PNG/WebP image before exporting.',
          );
      };
      for (const item of rig.bones) {
        edge(rigAsset, bone(item.id), `Rig of "${entry.name}"`);
        if (item.parent) edge(bone(item.id), bone(item.parent), `Bone "${item.id}" parent`);
        if (item.sprite) sprite(bone(item.id), item.sprite, `Character "${entry.name}", bone "${item.id}"`);
      }
      for (const item of rig.ik ?? []) {
        edge(rigAsset, ik(item.name), `Rig of "${entry.name}"`);
        for (const id of [item.rootBone, item.middleBone, item.endBone])
          edge(ik(item.name), bone(id), `IK "${item.name}"`);
      }
      for (const item of rig.slots ?? []) {
        edge(rigAsset, asset('slot', entry.id, item.id), `Rig of "${entry.name}"`);
        edge(asset('slot', entry.id, item.id), bone(item.bone), `Slot "${item.id}"`);
      }
      for (const item of rig.attachments ?? []) {
        edge(rigAsset, asset('attachment', entry.id, item.id), `Rig of "${entry.name}"`);
        const from = asset('attachment', entry.id, item.id);
        sprite(from, item, `Character "${entry.name}", attachment "${item.id}"`);
        if (item.type === 'mesh') {
          for (const bind of item.bindPose.bones) edge(from, bone(bind.id), `Mesh "${item.id}" bind pose`);
          for (const slot of item.bindPose.slots)
            edge(from, asset('slot', entry.id, slot.id), `Mesh "${item.id}" bind slot`);
          for (const id of new Set(
            item.vertices.flatMap((vertex) => vertex.influences?.map((influence) => influence.boneId) ?? []),
          ))
            edge(from, bone(id), `Mesh "${item.id}" bone weights`);
        }
      }
      for (const skin of [...(rig.skins ?? []), ...skins]) {
        edge(target, asset('skin', entry.id, skin.name), `Character "${entry.name}"`);
        for (const [slot, attachment] of Object.entries(skin.slots)) {
          const from = asset('skin', entry.id, skin.name);
          edge(from, asset('slot', entry.id, slot), `Skin "${skin.name}"`);
          if (attachment !== null)
            edge(from, asset('attachment', entry.id, attachment), `Skin "${skin.name}", slot "${slot}"`);
        }
      }
      for (const clip of animations) {
        const from = asset('animation', entry.id, clip.name);
        edge(target, from, `Character "${entry.name}"`);
        for (const id of Object.keys(clip.tracks)) edge(from, bone(id), `Animation "${clip.name}" bone track`);
        for (const id of Object.keys(clip.deformationTracks ?? {}))
          edge(from, asset('attachment', entry.id, id), `Animation "${clip.name}" mesh deformation track`);
        for (const id of new Set([...Object.keys(clip.ikTracks ?? {}), ...(clip.disabledIKConstraints ?? [])]))
          edge(from, ik(id), `Animation "${clip.name}" IK`);
      }
      for (const pose of snapshot.poses ?? definition.poses) {
        edge(target, asset('pose', entry.id, pose.name), `Character "${entry.name}"`);
        for (const id of Object.keys(pose.bones))
          edge(asset('pose', entry.id, pose.name), bone(id), `Pose "${pose.name}"`);
      }
      for (const marker of rig.footContactMarkers ?? [])
        edge(rigAsset, bone(marker.boneId), `Foot contact marker "${marker.name}"`);
    }
    for (const mapping of project.rigMappings ?? []) {
      const target = asset('rig-mapping', project.id, mapping.id);
      for (const id of new Set([mapping.sourceRigId, mapping.targetRigId]))
        edge(target, asset('character', id), `Rig mapping "${mapping.name}"`);
      const source = input.characters.get(mapping.sourceRigId)?.snapshot;
      const destination = input.characters.get(mapping.targetRigId)?.snapshot;
      if (!source || !destination) {
        add(
          target,
          `Mapping "${mapping.name}" references an unavailable rig.`,
          'rigMappings',
          'warning',
          'project',
          'Open Rig compatibility & bone mapping and repair or remove the saved mapping.',
        );
        continue;
      }
      try {
        for (const issue of validateRigBoneMapping(
          { id: mapping.sourceRigId, rig: source.rig },
          { id: mapping.targetRigId, rig: destination.rig },
          mapping,
        ))
          add(
            target,
            `Mapping "${mapping.name}": ${issue.message}`,
            'rigMappings',
            'warning',
            'project',
            'Review current rig revisions and save an approved mapping before reuse.',
          );
      } catch (error) {
        add(
          target,
          `Mapping "${mapping.name}": ${error instanceof Error ? error.message : String(error)}`,
          'rigMappings',
          'warning',
        );
      }
    }
    for (const entry of [...(project.sceneReuse?.choreographies ?? []), ...(project.sceneReuse?.templates ?? [])]) {
      const target = asset('scene', `reuse:${entry.id}`);
      const label = `Reusable asset "${entry.name}"`;
      for (const issue of validateSceneDefinition(entry.scene, {
        characters: catalog,
        images: new Set(project.images?.map((image) => `../${image.path}`)),
        getAudioAssets: () => project.audio ?? [],
      }))
        add(target, `${label}: ${issue.message}`, issue.path, issue.severity, 'project');
      for (const actor of entry.scene.actors) {
        const owner = referenceIds.get(actor.character.manifest) ?? actor.character.manifest;
        edge(target, asset('character', owner), label);
        if (actor.animation) edge(target, asset('animation', owner, actor.animation), label);
        if (actor.dialogueIdle) edge(target, asset('animation', owner, actor.dialogueIdle.animation), label);
        if (actor.skin) edge(target, asset('skin', owner, actor.skin), label);
      }
      for (const action of entry.scene.actions) {
        if (action.type !== 'animation') continue;
        const actor = entry.scene.actors.find((actor) => actor.id === action.actorId)!;
        const owner = referenceIds.get(actor.character.manifest) ?? actor.character.manifest;
        edge(target, asset('animation', owner, action.animation), label);
      }
      for (const clip of entry.scene.audioClips ?? []) edge(target, asset('audio', project.id, clip.assetId), label);
    }
    for (const entry of project.scenes) {
      const target = asset('scene', entry.id);
      edge(asset('project', project.id), target, `Project "${project.name}"`);
      const source = input.scenes.get(entry.id);
      const parsed = sceneDefinitionSchema.safeParse(source);
      const references = parsed.success
        ? [...new Set(parsed.data.actors.map((actor) => actor.character.manifest))]
        : [];
      const catalogKey = canonicalJson(references.map((reference) => [reference, catalog.get(reference) ?? null]));
      const imageReferences = new Set(project.images?.map((image) => `../${image.path}`));
      const key = canonicalJson([source ?? null, catalogKey, [...imageReferences], project.audio ?? []]);
      let cached = this.scenes.get(entry.id);
      if (cached?.key !== key) {
        checked.scenes++;
        cached = {
          key,
          issues: validateSceneDefinition(source, {
            characters: catalog,
            images: imageReferences,
            getAudioAssets: () => project.audio ?? [],
          }),
        };
        this.scenes.set(entry.id, cached);
      }
      for (const issue of cached.issues) {
        const scene = parsed.success ? parsed.data : undefined;
        const dialogueIndex = issue.path?.match(/^dialogue\[(\d+)\]/)?.[1];
        const line = dialogueIndex === undefined ? undefined : scene?.dialogue?.[Number(dialogueIndex)];
        const actorIndex = issue.path?.match(/^actors\[(\d+)\]/)?.[1];
        const actionIndex = issue.path?.match(/^actions\[(\d+)\]/)?.[1];
        const actor = actorIndex === undefined ? undefined : scene?.actors[Number(actorIndex)];
        const action = actionIndex === undefined ? undefined : scene?.actions[Number(actionIndex)];
        const location = actor
          ? `, Actor "${actor.id}"`
          : action
            ? `, action "${action.id}" on Actor "${action.actorId}"`
            : line
              ? `, dialogue "${line.id}"`
              : '';
        add(
          target,
          `Scene "${scene?.name ?? entry.id}"${location}: ${issue.message}`,
          issue.path,
          issue.severity,
          'scene',
        );
      }
      if (!parsed.success) continue;
      const scene = parsed.data;
      if (scene.id !== entry.id)
        add(target, `Scene "${scene.name}" has a different ID from its project registration.`, 'id', 'error', 'scene');
      for (const clip of scene.audioClips ?? [])
        edge(target, asset('audio', project.id, clip.assetId), `Scene "${scene.name}", audio clip "${clip.id}"`);
      for (const line of scene.dialogue ?? []) {
        const from = asset('dialogue', entry.id, line.id);
        edge(target, from, `Scene "${scene.name}"`);
        if (line.actorId)
          edge(from, asset('actor', entry.id, line.actorId), `Scene "${scene.name}", dialogue "${line.id}" speaker`);
        const voice = scene.audioClips?.find((clip) => clip.id === line.voiceClipId);
        if (voice)
          edge(
            from,
            asset('audio', project.id, voice.assetId),
            `Scene "${scene.name}", dialogue "${line.id}" voice reference`,
          );
      }
      const actors = new Map(scene.actors.map((item) => [item.id, item]));
      for (const item of scene.actors) {
        const from = asset('actor', entry.id, item.id);
        const owner = referenceIds.get(item.character.manifest) ?? item.character.manifest;
        edge(target, from, `Scene "${scene.name}"`);
        edge(from, asset('character', owner), `Scene "${scene.name}", Actor "${item.id}"`);
        if (item.animation)
          edge(
            from,
            asset('animation', owner, item.animation),
            `Scene "${scene.name}", Actor "${item.id}" initial animation`,
          );
        if (item.skin)
          edge(from, asset('skin', owner, item.skin), `Scene "${scene.name}", Actor "${item.id}" initial skin`);
        const sharedOwner = project.characters.find((entry) => entry.id === owner)?.variant?.rig;
        if (sharedOwner && item.skin)
          edge(from, asset('skin', sharedOwner, item.skin), `Scene "${scene.name}", variant Actor "${item.id}" skin`);
      }
      for (const item of scene.actions) {
        const from = asset('action', entry.id, item.id);
        edge(target, from, `Scene "${scene.name}"`);
        edge(from, asset('actor', entry.id, item.actorId), `Scene "${scene.name}", action "${item.id}"`);
        if (item.type === 'face' && item.target.type === 'actor')
          edge(
            from,
            asset('actor', entry.id, item.target.actorId),
            `Scene "${scene.name}", look target of "${item.id}"`,
          );
        const actor = actors.get(item.actorId);
        if (item.type === 'animation' && actor)
          edge(
            from,
            asset('animation', referenceIds.get(actor.character.manifest) ?? actor.character.manifest, item.animation),
            `Scene "${scene.name}", clip "${item.id}" on Actor "${item.actorId}"`,
          );
      }
    }
    if (project.stories?.length) {
      const assetKey = (value: AssetReference) => JSON.stringify([value.kind, value.owner, value.id]);
      const outgoing = new Map<string, AssetReference[]>();
      for (const { from, to } of dependencies) {
        const key = assetKey(from);
        const list = outgoing.get(key) ?? [];
        list.push(to);
        outgoing.set(key, list);
      }
      const errors = new Map<string, ProjectDiagnostic[]>();
      for (const issue of issues) {
        if (issue.severity !== 'error') continue;
        const key = assetKey(issue.asset);
        const list = errors.get(key) ?? [];
        list.push(issue);
        errors.set(key, list);
      }
      const registeredScenes = new Set(project.scenes.map(({ id }) => id));
      for (const story of project.stories ?? []) {
        const target = asset('story', project.id, story.id);
        edge(asset('project', project.id), target, `Project "${project.name}"`);
        for (const [index, entry] of story.scenes.entries()) {
          edge(target, asset('scene', entry.sceneAssetId), `Story "${story.name}", entry "${entry.id}"`);
          if (!registeredScenes.has(entry.sceneAssetId))
            add(
              target,
              `Story "${story.name}": Missing scene asset "${entry.sceneAssetId}".`,
              `scenes[${index}].sceneAssetId`,
            );
        }
        for (const issue of validateStoryDefinition(story))
          add(target, `Story "${story.name}": ${issue.message}`, issue.path, issue.severity);
        // Follow existing scene/Actor/character edges to include broken transitive assets.
        const queue = story.scenes.map(({ sceneAssetId }) => asset('scene', sceneAssetId));
        const visited = new Set<string>();
        while (queue.length) {
          const current = queue.pop()!;
          const key = assetKey(current);
          if (visited.has(key)) continue;
          visited.add(key);
          for (const issue of errors.get(key) ?? [])
            add(target, `Story "${story.name}" dependency: ${issue.message}`, 'scenes');
          queue.push(...(outgoing.get(key) ?? []));
        }
      }
    }
    const characterIds = new Set(project.characters.map((entry) => entry.id));
    const sceneIds = new Set(project.scenes.map((entry) => entry.id));
    for (const id of this.characters.keys()) if (!characterIds.has(id)) this.characters.delete(id);
    for (const id of this.scenes.keys()) if (!sceneIds.has(id)) this.scenes.delete(id);
    return finish();
  }
}
