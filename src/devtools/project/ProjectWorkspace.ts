import { canonicalJson } from '../../engine/authoredSerialization.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { equalJsonData } from '../../engine/equalJsonData.js';
import { validatePackageFiles } from '../../engine/packageZip.js';
import { freezeData, type DeepReadonly } from '../../engine/readonlyData.js';
import { createEmptyScene, parseSceneDefinition, type SceneDefinition } from '../../engine/SceneDefinition.js';
import { SceneEditorDocument } from '../scene-editor/SceneEditorDocument.js';
import {
  capturePackage,
  type PackageFiles,
  type PackageSnapshot,
  validatePackage,
} from '../shared/package/characterPackage.js';
import { PackageFingerprints } from '../shared/package/PackageFingerprints.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
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
  /** The mounted character editor is the sole working-copy owner. */
  capture?: () => PackageSnapshot;
  pending?: () => boolean;
  loading: boolean;
}

/** Membership history retains resources, so undo never recreates or overwrites a document. */
export class ProjectWorkspace {
  private metadata: DeepReadonly<ProjectDefinition>;
  private saved: DeepReadonly<ProjectDefinition> | undefined;
  private readonly characters = new Map<string, ProjectCharacter>();
  private readonly fingerprints = new Map<string, PackageFingerprints>();
  private readonly artwork = new Map<string, Uint8Array<ArrayBuffer>>();
  private readonly checkpoints = new Map<string, string>();
  private sceneCheckpoints = new Map<string, string>();
  readonly scenes = new SceneEditorDocument();
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
  }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): number => this.revision;
  readonly refresh = (): void => {
    this.revision++;
    for (const listener of Array.from(this.listeners)) listener();
  };
  get definition(): DeepReadonly<ProjectDefinition> {
    return this.metadata;
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
    return canonicalJson({
      metadata: this.metadata,
      characters,
      scenes: this.metadata.scenes.map(({ id }) => this.scenes.scene(id)),
    });
  }
  private createHistory(): SnapshotHistory<DeepReadonly<ProjectDefinition>> {
    return new SnapshotHistory(
      () => this.metadata,
      (value) => {
        const references = new Set(value.characters.map((entry) => entry.manifest));
        for (const { id } of value.scenes) {
          if (this.scenes.scene(id)?.actors.some((actor) => !references.has(actor.character.manifest)))
            throw new Error(
              `Project history would remove a character used by scene "${id}". Undo the scene edit first.`,
            );
        }
        this.metadata = value;
      },
      equalJsonData,
    );
  }
  get dirty(): boolean {
    return !this.saved || !equalJsonData(this.metadata, this.saved);
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
  captureCharacter(id: string): PackageSnapshot {
    const entry = this.character(id);
    if (entry.loading) throw new Error(`Character "${id}" is still opening. Wait for the editor to load.`);
    return capturePackage(this.workingCharacter(entry));
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
    return canonicalJson(this.scenes.scene(id)) !== this.sceneCheckpoints.get(id);
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
            skins: [...snapshot.skins, ...(snapshot.rig.skins ?? [])].map((skin) => skin.name),
          },
        ];
      }),
    );
    return parseSceneDefinition(scene, { characters });
  }
  /** Only committed authored revisions call this; playback and selection need no validation. */
  inspect(context: ValidationContext = 'draft', fresh = false, scene?: SceneDefinition): ProjectInspection {
    const references = scene && new Set(scene.actors.map((actor) => actor.character.manifest));
    const metadata = references
      ? {
          ...this.metadata,
          characters: this.metadata.characters.filter((entry) => references.has(entry.manifest)),
          scenes: [{ id: scene.id, path: 'scene.json' }],
        }
      : this.metadata;
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
      if (dependents.length)
        throw new Error(
          `Character is used by scenes: ${dependents.map((entry) => `${entry.label} (scene ID: ${entry.from.owner})`).join('; ')}. Remove or replace these references first.`,
        );
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
    this.sceneCheckpoints = new Map(scenes.map((scene) => [scene.id, canonicalJson(scene)]));
    this.refresh();
  }
  /** Archive import keeps stable paths; initialized documents remain separate owners. */
  installImportedMetadata(metadata: ProjectDefinition): void {
    const value = parseProjectDefinition(metadata);
    if (
      value.characters.some(({ id }) => !this.characters.has(id)) ||
      value.scenes.some(({ id }) => !this.scenes.scene(id))
    )
      throw new Error('Project metadata references missing documents.');
    this.metadata = freezeData(value);
    this.markExported(
      value,
      new Map(value.characters.map(({ id }) => [id, this.captureCharacter(id)])),
      value.scenes.map(({ id }) => parseSceneDefinition(this.scenes.scene(id))),
    );
    // Imported membership is the source baseline, not a set of user registration operations.
    this.history = this.createHistory();
  }
}
