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
import { mergeSkins } from '../../engine/mergeSkins.js';
import { validatePackageFiles } from '../../engine/packageZip.js';
import { freezeData, type DeepReadonly } from '../../engine/readonlyData.js';
import {
  rigBoneMappingSchema,
  validateRigBoneMapping,
  type RigBoneMapping,
  type IdentifiedRig,
} from '../../engine/rigBoneMapping.js';
import { analyzeRigCompatibility } from '../../engine/rigCompatibility.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  type SceneCharacterAssets,
  type SceneDefinition,
} from '../../engine/SceneDefinition.js';
import { identifierSchema } from '../../engine/schemas.js';
import { SceneEditorDocument } from '../scene-editor/SceneEditorDocument.js';
import type { AnimationLibraryEntry } from '../shared/animationLibraryData.js';
import {
  animationPreviewPreferencesSchema,
  type AnimationPreviewPreferences,
} from '../shared/animationPreviewPreferences.js';
import { draftSource } from '../shared/draftSource.js';
import {
  buildCharacterPackage,
  capturePackage,
  type PackageFiles,
  type PackageSnapshot,
  validatePackage,
} from '../shared/package/characterPackage.js';
import { PackageFingerprints } from '../shared/package/PackageFingerprints.js';
import { sceneFingerprint } from '../shared/sceneFingerprint.js';
import { emptySceneReuseLibrary, parseSceneReuseLibrary, type SceneReuseLibrary } from '../shared/sceneReuse.js';
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
import { characterFileFetcher } from './projectPackage.js';

export interface ProjectCharacter {
  readonly id: string;
  readonly definition: CharacterDefinition;
  readonly files: PackageFiles;
  /** Project-owned documents outlive renderer eviction, including their histories. */
  documents?: ProjectCharacterDocument;
  capture?: () => PackageSnapshot;
  pending?: () => boolean;
  loading: boolean;
}

/** Current documents, checkpoints and membership history retain resources needed for restoration. */
export class ProjectWorkspace {
  private metadata: DeepReadonly<ProjectDefinition>;
  private previewPreferences: DeepReadonly<NonNullable<ProjectDefinition['editorPreferences']>['animationPreview']> =
    {};
  private saved: DeepReadonly<ProjectDefinition> | undefined;
  private readonly characters = new Map<string, ProjectCharacter>();
  private readonly characterManifests = new Map<string, string>();
  private readonly fingerprints = new Map<string, PackageFingerprints>();
  private readonly artwork = new Map<string, Uint8Array<ArrayBuffer>>();
  private readonly audioFiles = new Map<string, Uint8Array<ArrayBuffer>>();
  private readonly checkpoints = new Map<string, string>();
  private readonly variantAppearances = new WeakMap<
    object,
    {
      source: PackageSnapshot['skins'];
      selected: PackageSnapshot['skins'][number];
      base: PackageSnapshot['skins'][number] | undefined;
      skins: PackageSnapshot['skins'];
    }
  >();
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
    () => [
      ...Object.values(this.previewPreferences).flatMap((preferences) =>
        preferences.environment.image ? [preferences.environment.image] : [],
      ),
      ...[this.metadata, ...this.history.retainedSnapshots, ...(this.saved ? [this.saved] : [])].flatMap(
        (project) =>
          project.sceneReuse?.templates.flatMap((entry) => entry.scene.images?.map((image) => image.image) ?? []) ?? [],
      ),
    ],
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
    this.scenes.subscribe(() => {
      // Registration notifies before membership is recorded. Only membership edits collect scene owners.
      this.collectAssets(false);
      this.refresh();
    });
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
  get sceneReuse(): DeepReadonly<SceneReuseLibrary> {
    return this.metadata.sceneReuse ?? this.scenes.sceneReuse;
  }
  setSceneReuse(input: unknown): void {
    this.change({ ...this.metadata, sceneReuse: parseSceneReuseLibrary(input) });
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
    this.collectAssets();
    this.refresh();
  }
  get autosaveRevision(): string | undefined {
    if (this.scenes.hasOpenOperation) return undefined;
    const characters: string[] = [];
    for (const { id } of this.metadata.characters) {
      const entry = this.character(id);
      const owner = this.character(this.rigOwner(id));
      if (entry.loading || entry.pending?.() || owner.loading || owner.pending?.()) return undefined;
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
        for (const entry of value.characters) {
          if (!entry.variant) continue;
          const owner = this.characters.get(entry.variant.rig);
          if (!owner) throw new Error(`Variant "${entry.name}" has no shared rig owner.`);
          const snapshot = this.workingCharacter(owner);
          if (!mergeSkins(snapshot.rig.skins ?? [], snapshot.skins).some((skin) => skin.name === entry.variant!.skin))
            throw new Error(
              `Variant "${entry.name}" needs skin "${entry.variant.skin}". Restore that skin before project history.`,
            );
        }
        const characters = new Set(value.characters.map((entry) => entry.manifest));
        const audio = new Set(value.audio?.map((entry) => entry.id));
        // Images live in the scene registry, so membership restoration cannot remove them.
        // Check every scene in the target membership, including documents being restored.
        for (const scene of [
          ...value.scenes.map(({ id }) => this.scenes.scene(id)),
          ...[...(value.sceneReuse?.choreographies ?? []), ...(value.sceneReuse?.templates ?? [])].map(
            (entry) => entry.scene,
          ),
        ]) {
          const id = scene?.id;
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
  /** Read-only asset feedback remains available while a renderer is opening or a proposal is pending. */
  characterInventory(id: string): PackageSnapshot {
    return this.workingCharacter(this.character(id));
  }
  characterDocuments(id: string): ProjectCharacterDocument {
    if (this.rigOwner(id) !== id)
      throw new Error(
        'This variant shares its rig and animations. Open the shared owner or create an independent copy.',
      );
    const entry = this.character(id);
    if (!entry.documents) {
      entry.documents = new ProjectCharacterDocument(
        entry.definition,
        (texture) => {
          const dependents = this.dependents({ kind: 'texture', owner: id, id: texture }).filter(
            ({ from }) => from.kind !== 'character' || from.owner !== id,
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
            .filter(({ from }) => from.kind === 'actor' || (from.kind === 'character' && from.owner !== id))
            .map(({ label }) => label),
      );
      entry.capture = entry.documents.capture;
    }
    return entry.documents;
  }
  /** Stable shared identity, independent of labels and selected appearance. No live inheritance chains. */
  rigOwner(id: string): string {
    const entry = this.metadata.characters.find((entry) => entry.id === id);
    if (!entry) throw new Error(`Unknown project character "${id}".`);
    return entry.variant?.rig ?? id;
  }
  sharedRigUsers(id: string): readonly string[] {
    const owner = this.rigOwner(id);
    return this.metadata.characters
      .filter((entry) => entry.id === owner || entry.variant?.rig === owner)
      .map((entry) => entry.name);
  }
  characterSkins(id: string): readonly string[] {
    const source = this.workingCharacter(this.character(this.rigOwner(id)));
    return mergeSkins(source.rig.skins ?? [], source.skins).map((skin) => skin.name);
  }
  appearanceWarnings(id: string, skin: string): readonly string[] {
    const source = this.workingCharacter(this.character(this.rigOwner(id)));
    const selected = mergeSkins(source.rig.skins ?? [], source.skins).find((entry) => entry.name === skin);
    if (!selected) throw new Error(`Unknown appearance skin "${skin}".`);
    const meshes = source.rig.attachments?.filter((attachment) => attachment.type === 'mesh') ?? [];
    if (!meshes.length) return [];
    return [
      'Mesh skins keep their own geometry, UVs, bone weights and bind data. Artwork must keep the mesh image dimensions and pivot; use an independent copy to rebuild different geometry.',
      ...(source.animations.some((clip) => Object.keys(clip.deformationTracks ?? {}).length)
        ? [
            'Corrective deformation stays with its original attachment and vertex IDs. Switching attachments does not transfer corrections to another mesh.',
          ]
        : []),
    ];
  }
  setVariantSkin(id: string, skin: string): void {
    this.characterDraft(this.rigOwner(id));
    const entry = this.metadata.characters.find((entry) => entry.id === id);
    if (!entry?.variant) throw new Error('Only a shared-rig variant has a selected appearance.');
    this.appearanceWarnings(id, skin); // Recheck against the current committed owner, including after Undo.
    this.change({
      ...this.metadata,
      characters: this.metadata.characters.map((entry) =>
        entry.id === id ? { ...entry, variant: { ...entry.variant!, skin } } : entry,
      ),
    });
  }
  setCharacterTemplate(id: string, template: boolean): void {
    this.character(id);
    if (this.rigOwner(id) !== id) throw new Error('Only an independent rig owner can be a reusable template.');
    this.change({
      ...this.metadata,
      characters: this.metadata.characters.map((entry) => (entry.id === id ? { ...entry, template } : entry)),
    });
  }
  createCharacterVariant(source: string, name: string, skin: string, id: string = crypto.randomUUID()): string {
    identifierSchema.parse(id);
    const owner = this.rigOwner(source);
    this.characterDraft(owner);
    this.appearanceWarnings(owner, skin);
    const issues = this.inspect('export').issues.filter(
      (issue) => issue.asset.owner === owner && issue.severity === 'error',
    );
    if (issues.length)
      throw new Error(`Repair the shared rig dependencies first: ${issues.map((issue) => issue.message).join('; ')}`);
    this.available('characters', id);
    if ([...this.characters.keys()].some((held) => held.toLowerCase() === id.toLowerCase()))
      throw new Error(`Character ID "${id}" is retained by project history.`);
    const original = this.character(owner);
    const proposal = parseProjectDefinition({
      ...this.metadata,
      characters: [
        ...this.metadata.characters,
        {
          id,
          name: name.trim(),
          manifest: this.path('characters'),
          variant: { rig: owner, skin },
        },
      ],
    });
    // Reuse the original immutable binary map. The variant owns only metadata, never editor documents.
    const entry: ProjectCharacter = { id, definition: original.definition, files: original.files, loading: false };
    this.characters.set(id, entry);
    this.characterManifests.set(id, proposal.characters.at(-1)!.manifest);
    this.fingerprints.set(id, new PackageFingerprints());
    this.change(proposal);
    this.checkpoints.set(id, this.characterDigest(id, entry));
    return id;
  }
  /** Explicit snapshot copy: future template/owner changes do not affect this new skeleton or clips. */
  async copyCharacter(source: string, name: string, id: string = crypto.randomUUID()): Promise<string> {
    this.characterDraft(source);
    const snapshot = this.captureCharacter(source);
    const files = this.character(source).files;
    return this.addCharacter(
      await buildCharacterPackage(
        {
          ...snapshot,
          identity: {
            id,
            defaultSkin: snapshot.identity?.defaultSkin ?? snapshot.definition.defaultSkin,
          },
        },
        characterFileFetcher(files),
      ),
      name.trim(),
    );
  }
  async createCharacterFromTemplate(template: string, name: string, id?: string): Promise<string> {
    if (!this.metadata.characters.find((entry) => entry.id === template)?.template)
      throw new Error('Select a registered character template.');
    return this.copyCharacter(template, name, id);
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
    this.collectAssets();
    this.refresh();
  }
  rename(name: string): void {
    this.change({ ...this.metadata, name: name.trim() });
  }
  undo(): void {
    this.history.undo();
    this.collectAssets();
    this.refresh();
  }
  redo(): void {
    this.history.redo();
    this.collectAssets();
    this.refresh();
  }
  /** Scene sources, checkpoints and local histories can outlive their project membership references. */
  private collectAssets(collectScenes = true): void {
    // Most editor notifications have no removed owners. Avoid scanning document histories in that case.
    if (
      this.characters.size === this.metadata.characters.length &&
      this.audioFiles.size === (this.metadata.audio?.length ?? 0) &&
      this.scenes.sceneIds.length === this.metadata.scenes.length
    )
      return;
    const projects = [this.metadata, ...this.history.retainedSnapshots, ...(this.saved ? [this.saved] : [])];
    const characters = new Set(projects.flatMap((project) => project.characters.map(({ id }) => id)));
    const scenes = new Set(projects.flatMap((project) => project.scenes.map(({ id }) => id)));
    const audio = new Set(projects.flatMap((project) => project.audio?.map(({ id }) => id) ?? []));
    if (collectScenes) this.scenes.retainScenes(scenes);
    const referencedManifests = new Set<string>();
    const reusableScenes = projects.flatMap((project) =>
      [...(project.sceneReuse?.choreographies ?? []), ...(project.sceneReuse?.templates ?? [])].map(
        (entry) => entry.scene,
      ),
    );
    for (const scene of [...this.scenes.retainedSnapshots, ...reusableScenes]) {
      for (const actor of scene.actors) referencedManifests.add(actor.character.manifest);
      for (const clip of scene.audioClips ?? []) audio.add(clip.assetId);
    }
    for (const [id, manifest] of this.characterManifests) if (referencedManifests.has(manifest)) characters.add(id);
    for (const [id, entry] of this.characters) {
      if (characters.has(id)) continue;
      this.characters.delete(id);
      this.characterManifests.delete(id);
      this.fingerprints.delete(id);
      this.checkpoints.delete(id);
      const { [id]: _preferences, ...preferences } = this.previewPreferences;
      this.previewPreferences = preferences;
      entry.documents?.artwork.dispose();
    }
    const artwork = new Set([...this.characters.values()].flatMap((entry) => [...entry.files.values()]));
    for (const [digest, bytes] of this.artwork) if (!artwork.has(bytes)) this.artwork.delete(digest);
    for (const id of this.audioFiles.keys()) if (!audio.has(id)) this.audioFiles.delete(id);
    for (const id of this.sceneCheckpoints.keys()) if (!scenes.has(id)) this.sceneCheckpoints.delete(id);
    this.inspector.retainAssets(characters, scenes);
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
      // A retained scene revision resolves characters by manifest, including after membership removal.
      ...this.characterManifests.values(),
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
    const entry = { id: definition.id, definition, files: owned, loading: false };
    for (const [path, digest] of images) {
      const bytes = this.artwork.get(digest) ?? owned.get(path)!;
      this.artwork.set(digest, bytes);
      owned.set(path, bytes);
    }
    this.characters.set(definition.id, entry);
    this.characterManifests.set(definition.id, proposal.characters.at(-1)!.manifest);
    this.fingerprints.set(definition.id, new PackageFingerprints());
    this.checkpoints.set(definition.id, this.characterDigest(definition.id, entry));
    this.change(proposal);
    return definition.id;
  }
  /** Derived inventory borrows immutable document snapshots; no keyframes are indexed or copied. */
  animationLibrary(): readonly AnimationLibraryEntry[] {
    return this.metadata.characters.flatMap(({ id, name }) => {
      const entry = this.character(id);
      if (entry.loading || this.character(this.rigOwner(id)).loading) return [];
      return this.workingCharacter(entry).animations.map((clip) => ({
        character: id,
        characterName: name,
        rigIdentity: this.rigOwner(id),
        clip,
      }));
    });
  }
  captureCharacter(id: string): PackageSnapshot {
    const entry = this.character(id);
    if (entry.loading || this.character(this.rigOwner(id)).loading)
      throw new Error(`Character "${id}" is still opening. Wait for the editor to load.`);
    return capturePackage(this.workingCharacter(entry));
  }
  /** Draft serialization captures changed branches itself and reuses unchanged revisions. */
  characterDraft(id: string): PackageSnapshot {
    const entry = this.character(id);
    const owner = this.character(this.rigOwner(id));
    if (entry.loading || entry.pending?.() || owner.loading || owner.pending?.())
      throw new Error(`Character "${id}" is opening or has pending edits. Finish them first.`);
    return this.workingCharacter(entry);
  }
  /** Borrow the current authored rig, never the preview's animated joints. */
  rigSource(id: string): IdentifiedRig {
    return { id, rig: this.characterDraft(id).rig };
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
    const registration = this.metadata.characters.find(({ id }) => id === entry.id);
    if (registration?.variant) {
      const source = this.workingCharacter(this.character(registration.variant.rig));
      const skins = mergeSkins(source.rig.skins ?? [], source.skins);
      const selected = skins.find((skin) => skin.name === registration.variant!.skin);
      if (!selected)
        throw new Error(`Variant "${registration.name}" references missing skin "${registration.variant.skin}".`);
      const base = skins.find((skin) => skin.name === source.definition.defaultSkin);
      let cached = this.variantAppearances.get(registration);
      if (!cached || cached.source !== source.skins || cached.selected !== selected || cached.base !== base) {
        const appearance = freezeData({ ...selected, slots: { ...base?.slots, ...selected.slots } });
        cached = {
          source: source.skins,
          selected,
          base,
          skins: freezeData([...source.skins.filter((skin) => skin.name !== selected.name), appearance]),
        };
        this.variantAppearances.set(registration, cached);
      }
      return {
        ...source,
        identity: { id: registration.id, defaultSkin: selected.name },
        // Promote embedded skins for portable manifest defaults; fill inherited mappings without editing the source.
        skins: cached.skins,
      };
    }
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
    const snapshot = this.workingCharacter(entry);
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
    const characters = new Map<string, SceneCharacterAssets>();
    // Borrow current immutable documents once per manifest; validation needs no detached package copies.
    for (const { character } of scene.actors) {
      if (characters.has(character.manifest)) continue;
      const id = this.resolveCharacter(character.manifest);
      const entry = this.character(id);
      if (entry.loading) throw new Error(`Character "${id}" is still opening. Wait for the editor to load.`);
      const snapshot = this.workingCharacter(entry);
      if (snapshot.pendingArtwork) throw new Error('Apply or cancel the artwork proposal before exporting a package.');
      characters.set(character.manifest, {
        animations: snapshot.animations.map((clip) => clip.name),
        rootMotionAnimations: snapshot.animations
          .filter((clip) => clip.rootMotion?.translationKeys.length)
          .map((clip) => clip.name),
        skins: [...snapshot.skins, ...(snapshot.rig.skins ?? [])].map((skin) => skin.name),
      });
    }
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
          sceneReuse: emptySceneReuseLibrary(),
          characters: this.metadata.characters.filter(
            (entry) =>
              references.has(entry.manifest) ||
              this.metadata.characters.some(
                (variant) => references.has(variant.manifest) && variant.variant?.rig === entry.id,
              ),
          ),
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
        const usage = dependents.some(({ from }) => from.kind === 'character')
          ? 'shared-rig variants'
          : dependents.every(({ from }) => from.kind === 'rig-mapping')
            ? 'rig mappings'
            : dependents.some(({ from }) => from.kind === 'rig-mapping')
              ? 'scenes and rig mappings'
              : 'scenes';
        throw new Error(
          `Character is used by ${usage}: ${dependents.map((entry) => `${entry.label} (${entry.from.kind === 'rig-mapping' ? 'mapping' : entry.from.kind === 'character' ? 'character' : 'scene'} ID: ${entry.from.kind === 'rig-mapping' ? entry.from.id : entry.from.owner})`).join('; ')}. Remove or replace these references first.`,
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
      this.checkpoints.set(
        id,
        canonicalJson((this.fingerprints.get(id) ?? new PackageFingerprints()).compute(snapshot)),
      );
    this.sceneCheckpoints = new Map(scenes.map((scene) => [scene.id, sceneFingerprint(scene)]));
    this.collectAssets();
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
    for (const entry of value.characters) {
      if (!entry.variant) continue;
      const character = this.characters.get(entry.id)!;
      const owner = this.characters.get(entry.variant.rig)!;
      if (
        !equalJsonData(character.definition.rigFile, owner.definition.rigFile) ||
        !equalJsonData(character.definition.animations, owner.definition.animations)
      )
        throw new Error(
          `Variant "${entry.name}" has diverged from its shared rig or animations. Import it as an independent character instead.`,
        );
      this.characters.set(entry.id, { ...character, files: owner.files });
    }
    for (const { id, manifest } of value.characters) this.characterManifests.set(id, manifest);
    this.markExported(
      value,
      new Map(value.characters.map(({ id }) => [id, this.captureCharacter(id)])),
      value.scenes.map(({ id }) => parseSceneDefinition(this.scenes.scene(id))),
    );
    // Imported membership is the source baseline, not a set of user registration operations.
    this.history = this.createHistory();
    this.collectAssets();
  }
}
