import { abortable } from '../../engine/abortable.js';
import { safeFilename } from '../../engine/assetFilename.js';
import {
  validateAudioAssetData,
  type AudioAssetDefinition,
  type AudioCategory,
  inspectAudioData,
  AUDIO_MAX_FILE_BYTES,
} from '../../engine/AudioAsset.js';
import type { AudioAssetLoader } from '../../engine/AudioAssetLoader.js';
import { canonicalJson } from '../../engine/authoredSerialization.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { equalJsonData } from '../../engine/equalJsonData.js';
import { validatePackageFiles } from '../../engine/packageZip.js';
import { freezeData, type DeepReadonly } from '../../engine/readonlyData.js';
import {
  rigBoneMappingSchema,
  validateRigBoneMapping,
  type RigBoneMapping,
  type IdentifiedRig,
} from '../../engine/rigBoneMapping.js';
import { analyzeRigCompatibility } from '../../engine/rigCompatibility.js';
import { createEmptyScene, parseSceneDefinition, type SceneDefinition } from '../../engine/SceneDefinition.js';
import { SceneEditorDocument } from '../scene-editor/SceneEditorDocument.js';
import type { AnimationLibraryEntry } from '../shared/animationLibraryData.js';
import {
  animationPreviewPreferencesSchema,
  type AnimationPreviewPreferences,
} from '../shared/animationPreviewPreferences.js';
import { draftSource } from '../shared/draftSource.js';
import {
  capturePackage,
  type PackageFiles,
  type PackageSnapshot,
  validatePackage,
} from '../shared/package/characterPackage.js';
import { PackageFingerprints } from '../shared/package/PackageFingerprints.js';
import { sceneFingerprint } from '../shared/sceneFingerprint.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
import { notifySubscribers } from '../shared/subscriberNotifications.js';
import { ProjectCharacterDocument } from './ProjectCharacterDocument.js';
import { parseProjectDefinition, type ProjectDefinition } from './ProjectDefinition.js';
import {
  assetDependents,
  ProjectInspector,
  type AssetReference,
  type ProjectInspection,
  type InspectionCharacter,
  type ValidationContext,
} from './projectInspection.js';

export interface ProjectCharacter {
  readonly definition: CharacterDefinition;
  readonly files: PackageFiles;
  /** Project-owned documents outlive renderer eviction, including their histories. */
  documents?: ProjectCharacterDocument;
  capture?: () => PackageSnapshot;
  pending?: () => boolean;
  loading: boolean;
}

/** Membership history retains resources, so undo never recreates or overwrites a document. */
export class ProjectWorkspace {
  private metadata: DeepReadonly<ProjectDefinition>;
  private previewPreferences: DeepReadonly<NonNullable<ProjectDefinition['editorPreferences']>['animationPreview']> =
    {};
  private saved: DeepReadonly<ProjectDefinition> | undefined;
  private readonly characters = new Map<string, ProjectCharacter>();
  private readonly fingerprints = new Map<string, PackageFingerprints>();
  private readonly artwork = new Map<string, Uint8Array<ArrayBuffer>>();
  private readonly audioFiles = new Map<string, Uint8Array<ArrayBuffer>>();
  private readonly checkpoints = new Map<string, string>();
  private sceneCheckpoints = new Map<string, string>();
  readonly scenes = new SceneEditorDocument(
    {
      getAudioAssets: () => (this.metadata.audio ?? []).map((asset) => ({ ...asset, path: `../${asset.path}` })),
      getCharacterAssets: (manifest) => {
        const entry = this.metadata.characters.find((entry) => entry.manifest === manifest);
        const character = entry && this.characters.get(entry.id);
        if (!character || character.loading) return undefined;
        const snapshot = this.workingCharacter(character);
        return {
          animations: snapshot.animations.map((clip) => clip.name),
          rootMotionAnimations: snapshot.animations
            .filter((clip) => clip.rootMotion?.translationKeys.length)
            .map((clip) => clip.name),
          skins: [...snapshot.skins, ...(snapshot.rig.skins ?? [])].map((skin) => skin.name),
        };
      },
    },
    undefined,
    () =>
      Object.values(this.previewPreferences).flatMap((preferences) =>
        preferences.environment.image ? [preferences.environment.image] : [],
      ),
    (id) => this.audioFiles.get(id),
  );
  private revision = 0;
  recoveryKey: string | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly inspector = new ProjectInspector();
  history: SnapshotHistory<DeepReadonly<ProjectDefinition>>;

  constructor(name: string, id: string = crypto.randomUUID()) {
    this.metadata = freezeData(
      parseProjectDefinition({ version: 1, id, name: name.trim(), characters: [], scenes: [] }),
    );
    this.history = this.createHistory();
    this.scenes.subscribe(this.refresh);
    this.scenes.images.subscribe(this.refresh);
  }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): number => this.revision;
  readonly refresh = (): void => {
    this.revision++;
    notifySubscribers(this.listeners, 'Project subscribers failed.');
  };
  get definition(): DeepReadonly<ProjectDefinition> {
    const images = this.scenes.images.entries.map((asset) => ({
      id: asset.reference.replace(/^(?:\.\.\/)+/, ''),
      name: asset.name,
      path: asset.reference.replace(/^(?:\.\.\/)+/, ''),
    }));
    const { images: _images, ...metadata } = this.metadata;
    return {
      ...metadata,
      ...(images.length ? { images } : {}),
      ...(Object.keys(this.previewPreferences).length
        ? { editorPreferences: { animationPreview: this.previewPreferences } }
        : {}),
    };
  }
  animationPreviewPreferences(id: string): DeepReadonly<AnimationPreviewPreferences> | undefined {
    return this.previewPreferences[id];
  }
  /** Preferences have no animation or membership Undo entries. Ground retains its own preference history. */
  setAnimationPreviewPreferences(id: string, input: unknown): void {
    this.character(id);
    const preferences = freezeData(animationPreviewPreferencesSchema.parse(input));
    if (equalJsonData(preferences, this.previewPreferences[id])) return;
    this.previewPreferences = { ...this.previewPreferences, [id]: preferences };
    this.refresh();
  }
  /** Recovery never claims that a browser snapshot was written to disk. */
  markRecovered(key: string): void {
    this.recoveryKey = key;
    this.saved = undefined;
    this.refresh();
  }
  get autosaveRevision(): string | undefined {
    if (this.scenes.hasOpenOperation) return undefined;
    const characters: string[] = [];
    for (const { id } of this.metadata.characters) {
      const entry = this.character(id);
      if (entry.loading || entry.pending?.()) return undefined;
      characters.push(this.characterDigest(id, entry));
    }
    return draftSource({
      metadata: this.definition,
      characters,
      scenes: this.metadata.scenes.map(({ id }) => sceneFingerprint(this.scenes.scene(id)!)),
    });
  }
  private createHistory(): SnapshotHistory<DeepReadonly<ProjectDefinition>> {
    return new SnapshotHistory(
      () => this.metadata,
      (value) => {
        const characters = new Set(value.characters.map((entry) => entry.manifest));
        const audio = new Set(value.audio?.map((entry) => entry.id));
        // Images live in the scene registry, so membership restoration cannot remove them.
        // Check every scene in the target membership, including documents being restored.
        for (const { id } of value.scenes) {
          const scene = this.scenes.scene(id);
          if (scene?.actors.some((actor) => !characters.has(actor.character.manifest)))
            throw new Error(
              `Project history would remove a character used by scene "${id}". Undo the scene edit first.`,
            );
          if (scene?.audioClips?.some((clip) => !audio.has(clip.assetId)))
            throw new Error(`Project history would remove audio used by scene "${id}". Undo the scene edit first.`);
        }
        this.metadata = value;
      },
      equalJsonData,
    );
  }
  get dirty(): boolean {
    return !this.saved || !equalJsonData(this.definition, this.saved);
  }
  get hasUnsavedChanges(): boolean {
    return (
      this.dirty ||
      this.metadata.characters.some(({ id }) => this.characterDirty(id)) ||
      this.metadata.scenes.some(({ id }) => this.sceneDirty(id))
    );
  }
  character(id: string): ProjectCharacter {
    if (!this.metadata.characters.some((entry) => entry.id === id))
      throw new Error(`Unknown project character "${id}".`);
    return this.characters.get(id)!;
  }
  characterReference(id: string): string {
    const entry = this.metadata.characters.find((entry) => entry.id === id);
    if (!entry) throw new Error(`Unknown project character "${id}".`);
    return entry.manifest;
  }
  characterDocuments(id: string): ProjectCharacterDocument {
    const entry = this.character(id);
    if (!entry.documents) {
      entry.documents = new ProjectCharacterDocument(
        entry.definition,
        (texture) => {
          const dependents = this.dependents({ kind: 'texture', owner: id, id: texture }).filter(
            ({ from }) => from.kind !== 'character',
          );
          return (
            !dependents.length ||
            window.confirm(
              `Replace texture "${texture}"? This affects:\n${dependents.map(({ label }) => label).join('\n')}\n\nReferences will be kept. Continue?`,
            )
          );
        },
        (skin) =>
          this.dependents({ kind: 'skin', owner: id, id: skin })
            .filter(({ from }) => from.kind === 'actor')
            .map(({ label }) => label),
      );
      entry.capture = entry.documents.capture;
    }
    return entry.documents;
  }
  disposeCharacterDocuments(): void {
    const errors: unknown[] = [];
    for (const entry of this.characters.values()) {
      try {
        entry.documents?.artwork.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Character document disposal failed.');
  }
  resolveCharacter(reference: string): string {
    const entry = this.metadata.characters.find((entry) => entry.manifest === reference);
    if (!entry) throw new Error(`Character reference "${reference}" is not registered in this project.`);
    return entry.id;
  }
  private change(proposal: DeepReadonly<ProjectDefinition>): void {
    const value = freezeData(parseProjectDefinition(proposal));
    this.history.change(() => {
      this.metadata = value;
    });
    this.refresh();
  }
  rename(name: string): void {
    this.change({ ...this.metadata, name: name.trim() });
  }
  undo(): void {
    this.history.undo();
    this.refresh();
  }
  redo(): void {
    this.history.redo();
    this.refresh();
  }
  audioSource(id: string) {
    const definition = this.metadata.audio?.find((entry) => entry.id === id);
    const bytes = this.audioFiles.get(id);
    // Binary ownership stays in the project. Runtime callers receive a detached copy.
    return definition && bytes ? { definition, bytes: new Uint8Array(bytes) } : undefined;
  }
  /** Low-level registration for validated packages. Browser imports decode before registration. */
  addAudio(input: AudioAssetDefinition, bytes: Uint8Array<ArrayBuffer>): void {
    const proposal = parseProjectDefinition({ ...this.metadata, audio: [...(this.metadata.audio ?? []), input] });
    const definition = proposal.audio!.at(-1)!;
    const paths = [
      'project.json',
      ...this.definition.characters.map((entry) => entry.manifest),
      ...this.definition.scenes.map((entry) => entry.path),
      ...(this.definition.images ?? []).map((entry) => entry.path),
      ...(this.definition.audio ?? []).map((entry) => entry.path),
    ].map((path) => path.toLowerCase());
    const path = definition.path.toLowerCase();
    if (paths.some((other) => path === other || path.startsWith(`${other}/`) || other.startsWith(`${path}/`)))
      throw new Error(`Project file collision at "${definition.path}". Choose a different audio path.`);
    if ([...this.audioFiles.keys()].some((id) => id.toLowerCase() === definition.id.toLowerCase()))
      throw new Error(`Audio ID "${definition.id}" is retained by project history.`);
    validateAudioAssetData(definition, bytes);
    // Membership Undo retains immutable binaries, bounded by the existing package limits.
    const retained = new Map<string, Uint8Array<ArrayBuffer>>(
      [...this.audioFiles.values()].map((data, index) => [`retained/${index}`, data]),
    );
    retained.set(definition.path, bytes);
    validatePackageFiles(retained);
    this.audioFiles.set(definition.id, new Uint8Array(bytes));
    this.change(proposal);
  }
  async importAudio(
    file: File,
    category: AudioCategory,
    loader: AudioAssetLoader,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!file || !file.size || file.size > AUDIO_MAX_FILE_BYTES)
      throw new Error('Audio must contain 1 byte–10 MiB. Choose a smaller nonempty audio file.');
    const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
    const bytes = new Uint8Array(await abortable(file.arrayBuffer(), active));
    const format = inspectAudioData(bytes);
    const decoded = await loader.prepare(bytes, active);
    active.throwIfAborted();
    const stem = safeFilename(file.name.replace(/\.[^.]+$/, '').replace(/[%#]/g, '_')).slice(0, 100) || 'audio';
    const used = new Set([
      ...(this.metadata.audio ?? []).map((entry) => entry.path.toLowerCase()),
      ...this.metadata.characters.map((entry) => entry.manifest.toLowerCase()),
      ...this.metadata.scenes.map((entry) => entry.path.toLowerCase()),
      ...(this.definition.images ?? []).map((entry) => entry.path.toLowerCase()),
    ]);
    let path = `audio/${stem}.${format}`;
    let suffix = 2;
    while (used.has(path.toLowerCase())) path = `audio/${stem}-${suffix++}.${format}`;
    const id = crypto.randomUUID();
    this.addAudio(
      {
        id,
        name:
          file.name
            .replace(/\.[^.]+$/, '')
            .trim()
            .slice(0, 200) || 'Audio',
        path,
        category,
        durationSeconds: decoded.durationSeconds,
      },
      bytes,
    );
    return id;
  }
  updateAudio(id: string, patch: { name?: string; category?: AudioCategory }): void {
    if (!this.metadata.audio?.some((entry) => entry.id === id)) throw new Error(`Unknown audio asset "${id}".`);
    this.change({
      ...this.metadata,
      audio: this.metadata.audio.map((entry) =>
        entry.id === id
          ? { ...entry, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) }
          : entry,
      ),
    });
  }
  removeAudio(id: string): void {
    const dependents = this.dependents({ kind: 'audio', owner: this.metadata.id, id }).filter(
      ({ from }) => from.kind !== 'project',
    );
    if (dependents.length)
      throw new Error(
        `Audio is in use: ${dependents.map((entry) => entry.label).join('; ')}. Remove its references first.`,
      );
    this.change({ ...this.metadata, audio: this.metadata.audio?.filter((entry) => entry.id !== id) ?? [] });
  }
  private available(kind: 'characters' | 'scenes', id: string): void {
    if (this.metadata[kind].some((entry) => entry.id.toLowerCase() === id.toLowerCase()))
      throw new Error(`Duplicate ${kind} ID "${id}".`);
  }
  private path(kind: 'characters' | 'scenes'): string {
    let index = 1;
    const used = new Set([
      ...this.metadata.characters.map((entry) => entry.manifest),
      ...this.metadata.scenes.map((entry) => entry.path),
    ]);
    let path: string;
    do {
      path = kind === 'characters' ? `characters/character-${index++}/character.json` : `scenes/scene-${index++}.json`;
    } while (used.has(path));
    return path;
  }
  async addCharacter(files: PackageFiles, name?: string): Promise<string> {
    // Project archives can alias one physical binary to many logical files.
    // Bound that expanded layout before allocating any detached byte copies.
    validatePackageFiles(files);
    // Detach incoming bytes; callers cannot mutate artwork after registration.
    const owned = new Map([...files].map(([path, bytes]) => [path, new Uint8Array(bytes)]));
    const definition = await validatePackage(owned);
    const images = new Map<string, string>();
    for (const path of new Set(Object.values(definition.textures))) {
      const bytes = owned.get(path)!;
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      images.set(path, digest);
    }
    this.available('characters', definition.id);
    if ([...this.characters.keys()].some((id) => id.toLowerCase() === definition.id.toLowerCase()))
      throw new Error(`Character ID "${definition.id}" is retained by project history.`);
    const proposal = parseProjectDefinition({
      ...this.metadata,
      characters: [
        ...this.metadata.characters,
        {
          id: definition.id,
          name: name ?? definition.rigFile?.name ?? definition.id,
          manifest: this.path('characters'),
        },
      ],
    });
    const entry = { definition, files: owned, loading: false };
    for (const [path, digest] of images) {
      const bytes = this.artwork.get(digest) ?? owned.get(path)!;
      this.artwork.set(digest, bytes);
      owned.set(path, bytes);
    }
    this.characters.set(definition.id, entry);
    this.fingerprints.set(definition.id, new PackageFingerprints());
    this.checkpoints.set(definition.id, this.characterDigest(definition.id, entry));
    this.change(proposal);
    return definition.id;
  }
  /** Derived inventory borrows immutable document snapshots; no keyframes are indexed or copied. */
  animationLibrary(): readonly AnimationLibraryEntry[] {
    return this.metadata.characters.flatMap(({ id, name }) => {
      const entry = this.character(id);
      if (entry.loading) return [];
      return this.workingCharacter(entry).animations.map((clip) => ({
        character: id,
        characterName: name,
        rigIdentity: id,
        clip,
      }));
    });
  }
  captureCharacter(id: string): PackageSnapshot {
    const entry = this.character(id);
    if (entry.loading) throw new Error(`Character "${id}" is still opening. Wait for the editor to load.`);
    return capturePackage(this.workingCharacter(entry));
  }
  /** Draft serialization captures changed branches itself and reuses unchanged revisions. */
  characterDraft(id: string): PackageSnapshot {
    const entry = this.character(id);
    if (entry.loading || entry.pending?.())
      throw new Error(`Character "${id}" is opening or has pending edits. Finish them first.`);
    return this.workingCharacter(entry);
  }
  /** Borrow the current authored rig, never the preview's animated joints. */
  rigSource(id: string): IdentifiedRig {
    const entry = this.character(id);
    if (entry.loading || entry.pending?.())
      throw new Error(`Character "${id}" is opening or has pending edits. Finish them first.`);
    return { id, rig: this.workingCharacter(entry).rig };
  }
  saveRigMapping(input: RigBoneMapping): void {
    const mapping = rigBoneMappingSchema.parse(input);
    const source = this.rigSource(mapping.sourceRigId),
      target = this.rigSource(mapping.targetRigId);
    const issues = validateRigBoneMapping(source, target, mapping);
    if (issues.some(({ severity }) => severity === 'error'))
      throw new Error(issues.map(({ message }) => message).join('\n'));
    this.change({
      ...this.metadata,
      rigMappings: [...(this.metadata.rigMappings ?? []).filter(({ id }) => id !== mapping.id), mapping],
    });
  }
  removeRigMapping(id: string): void {
    this.change({
      ...this.metadata,
      rigMappings: (this.metadata.rigMappings ?? []).filter((mapping) => mapping.id !== id),
    });
  }
  /** Always compare against the current working revisions, including after Undo, reload and import. */
  rigMappingReport(mapping: RigBoneMapping) {
    return analyzeRigCompatibility(this.rigSource(mapping.sourceRigId), this.rigSource(mapping.targetRigId), mapping);
  }
  private workingCharacter(entry: ProjectCharacter): PackageSnapshot {
    const snapshot = entry.capture?.() ?? {
      definition: entry.definition,
      rig: entry.definition.rigFile!,
      skins: entry.definition.standaloneSkins,
      animations: entry.definition.animations,
      replacements: [],
    };
    // Preview definitions can contain Blob URLs. The original package manifest owns portable paths.
    return { ...snapshot, definition: entry.definition };
  }
  private characterDigest(id: string, entry: ProjectCharacter): string {
    const snapshot = entry.capture?.() ?? {
      definition: entry.definition,
      rig: entry.definition.rigFile!,
      skins: entry.definition.standaloneSkins,
      animations: entry.definition.animations,
      replacements: [],
    };
    return canonicalJson(this.fingerprints.get(id)!.compute(snapshot));
  }
  characterDirty(id: string): boolean {
    const entry = this.character(id);
    return this.characterDigest(id, entry) !== this.checkpoints.get(id);
  }
  sceneDirty(id: string): boolean {
    return sceneFingerprint(this.scenes.scene(id)!) !== this.sceneCheckpoints.get(id);
  }
  addScene(input: unknown): string {
    const scene = parseSceneDefinition(input);
    this.available('scenes', scene.id);
    this.validateScene(scene);
    if (this.scenes.scene(scene.id)) throw new Error(`Scene ID "${scene.id}" is retained by project history.`);
    if (!this.scenes.importJson(JSON.stringify(scene))) throw new Error('Could not register scene.');
    this.change({ ...this.metadata, scenes: [...this.metadata.scenes, { id: scene.id, path: this.path('scenes') }] });
    return scene.id;
  }
  createScene(options: Parameters<typeof createEmptyScene>[0]): string {
    const scene = createEmptyScene(options);
    this.available('scenes', scene.id);
    if (this.scenes.scene(scene.id)) throw new Error(`Scene ID "${scene.id}" is retained by project history.`);
    if (!this.scenes.createScene(options)) throw new Error('Could not create scene.');
    this.change({ ...this.metadata, scenes: [...this.metadata.scenes, { id: scene.id, path: this.path('scenes') }] });
    return scene.id;
  }
  validateScene(input: unknown): SceneDefinition {
    const scene = parseSceneDefinition(input);
    const characters = new Map(
      scene.actors.map((actor) => {
        const id = this.resolveCharacter(actor.character.manifest);
        const snapshot = this.captureCharacter(id);
        return [
          actor.character.manifest,
          {
            animations: snapshot.animations.map((clip) => clip.name),
            rootMotionAnimations: snapshot.animations
              .filter((clip) => clip.rootMotion?.translationKeys.length)
              .map((clip) => clip.name),
            skins: [...snapshot.skins, ...(snapshot.rig.skins ?? [])].map((skin) => skin.name),
          },
        ];
      }),
    );
    return parseSceneDefinition(scene, {
      characters,
      images: new Set(this.scenes.images.entries.map((image) => image.reference)),
      getAudioAssets: () => this.metadata.audio ?? [],
    });
  }
  /** Only committed authored revisions call this; playback and selection need no validation. */
  inspect(context: ValidationContext = 'draft', fresh = false, scene?: SceneDefinition): ProjectInspection {
    const references = scene && new Set(scene.actors.map((actor) => actor.character.manifest));
    const metadata = references
      ? {
          ...this.definition,
          rigMappings: [],
          characters: this.metadata.characters.filter((entry) => references.has(entry.manifest)),
          audio: this.metadata.audio ?? [],
          scenes: [{ id: scene.id, path: 'scene.json' }],
        }
      : this.definition;
    const characters = new Map<string, InspectionCharacter>();
    for (const { id } of metadata.characters) {
      const entry = this.character(id);
      try {
        if (entry.loading) throw new Error(`Character "${id}" is still opening. Wait for the editor to load.`);
        characters.set(id, { snapshot: this.workingCharacter(entry), files: entry.files });
      } catch (error) {
        characters.set(id, { files: entry.files, unavailable: error instanceof Error ? error.message : String(error) });
      }
    }
    return this.inspector.inspect(
      {
        definition: metadata,
        characters,
        scenes: scene
          ? new Map([[scene.id, scene]])
          : new Map(metadata.scenes.map(({ id }) => [id, this.scenes.scene(id)])),
        audio: this.audioFiles,
      },
      context,
      fresh,
    );
  }
  dependents(target: AssetReference) {
    return assetDependents(this.inspect(), target);
  }
  remove(kind: 'characters' | 'scenes', id: string): void {
    if (kind === 'characters') {
      const dependents = this.dependents({ kind: 'character', owner: id, id }).filter(
        ({ from }) => from.kind !== 'project',
      );
      if (dependents.length) {
        const usage = dependents.every(({ from }) => from.kind === 'rig-mapping')
          ? 'rig mappings'
          : dependents.some(({ from }) => from.kind === 'rig-mapping')
            ? 'scenes and rig mappings'
            : 'scenes';
        throw new Error(
          `Character is used by ${usage}: ${dependents.map((entry) => `${entry.label} (${entry.from.kind === 'rig-mapping' ? 'mapping' : 'scene'} ID: ${entry.from.kind === 'rig-mapping' ? entry.from.id : entry.from.owner})`).join('; ')}. Remove or replace these references first.`,
        );
      }
    }
    this.change({ ...this.metadata, [kind]: this.metadata[kind].filter((entry) => entry.id !== id) });
  }
  /** Called only after download starts, using the captured revision, never newer edits. */
  markExported(
    metadata: DeepReadonly<ProjectDefinition>,
    characters: ReadonlyMap<string, PackageSnapshot>,
    scenes: readonly SceneDefinition[],
  ): void {
    this.saved = freezeData(parseProjectDefinition(metadata));
    for (const [id, snapshot] of characters)
      this.checkpoints.set(id, canonicalJson(this.fingerprints.get(id)!.compute(snapshot)));
    this.sceneCheckpoints = new Map(scenes.map((scene) => [scene.id, sceneFingerprint(scene)]));
    this.refresh();
  }
  /** Archive import keeps stable paths; initialized documents remain separate owners. */
  installImportedMetadata(metadata: ProjectDefinition): void {
    const value = parseProjectDefinition(metadata);
    if (
      value.characters.some(({ id }) => !this.characters.has(id)) ||
      value.audio?.some(({ id }) => !this.audioFiles.has(id)) ||
      value.scenes.some(({ id }) => !this.scenes.scene(id))
    )
      throw new Error('Project metadata references missing documents.');
    const { editorPreferences, ...documents } = value;
    this.previewPreferences = freezeData(editorPreferences?.animationPreview ?? {});
    this.metadata = freezeData(documents);
    this.markExported(
      value,
      new Map(value.characters.map(({ id }) => [id, this.captureCharacter(id)])),
      value.scenes.map(({ id }) => parseSceneDefinition(this.scenes.scene(id))),
    );
    // Imported membership is the source baseline, not a set of user registration operations.
    this.history = this.createHistory();
  }
}
