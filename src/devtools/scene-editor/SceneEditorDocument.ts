import {
  CAMERA_PROPERTIES,
  evaluateCameraAtTime,
  cameraForBounds,
  DEFAULT_CINEMATIC_CAMERA,
  equalJsonData,
  freezeData,
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  SceneValidationError,
  serializeSceneDefinition,
  type CameraProperty,
  type CameraKeyframe,
  type CameraViewport,
  type CinematicCameraState,
  type DeepReadonly,
  type SceneActorDefinition,
  type SceneImageDefinition,
  type SceneLayerDefinition,
  type SceneActionDefinition,
  type SceneDefinition,
  type SceneValidationOptions,
} from '../../engine/core.js';
import type {
  AudioAssetDefinition,
  AudioCategory,
  SceneAudioClip,
  SceneDialogueLine,
  SceneTransition,
  ValidationIssue,
} from '../../engine/data.js';
import { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import { emptySceneReuseLibrary, parseSceneReuseLibrary, type SceneReuseLibrary } from '../shared/sceneReuse.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
import { SceneArtworkCommands } from './SceneArtworkCommands.js';
import { SceneAudioCommands } from './SceneAudioCommands.js';
import { SceneCameraCommands } from './SceneCameraCommands.js';
import { SceneDialogueCommands, type SceneDialoguePatch } from './SceneDialogueCommands.js';
import { SceneEditorGestures } from './SceneEditorGestures.js';
import { SceneEditorNotifications } from './SceneEditorNotifications.js';
import { SceneImageRegistry } from './SceneImageRegistry.js';
import { SceneSnapshotParser } from './SceneSnapshotParser.js';
import { SceneTransitionCommands } from './SceneTransitionCommands.js';

export type ReadonlyScene = DeepReadonly<SceneDefinition>;
export interface ActorGroundContact {
  readonly id: string;
  readonly name: string;
  readonly offset: number | undefined;
}
interface SceneEntry {
  readonly source: ReadonlyScene;
  saved: ReadonlyScene;
  working: ReadonlyScene;
  unsavedNew: boolean;
  cameraSelected: boolean;
  cameraKeyEdit: boolean;
  selectedCameraKey: { property: CameraProperty; id: string } | null;
  cameraPreview: boolean;
  cameraOverlays: boolean;
  selectedImage: string | null;
  selectedActor: string | null;
  selectedAction: string | null;
  selectedActions: string[];
  selectedTransition: string | null;
  selectedAudioClip: string | null;
  selectedDialogueLine: string | null;
  readonly history: SnapshotHistory<ReadonlyScene>;
}

/** Independent scene sessions. Only validated, detached immutable authored snapshots enter history. */
export class SceneEditorDocument {
  private reuseLibrary = freezeData(emptySceneReuseLibrary());
  get sceneReuse(): DeepReadonly<SceneReuseLibrary> {
    return this.reuseLibrary;
  }
  setSceneReuse(input: unknown): void {
    this.reuseLibrary = freezeData(parseSceneReuseLibrary(input));
    this.notify('presentation');
  }

  readonly groundGuide = new GroundGuideWorkspace('scene-world', undefined, true);
  private readonly entries = new Map<string, SceneEntry>();
  private selected: string | null = null;
  private readonly notifications = new SceneEditorNotifications();
  private readonly gestures = new SceneEditorGestures(() => this.notify('presentation'));
  private readonly audioFiles = new Map<string, Uint8Array<ArrayBuffer>>();
  private readonly audioCommands = new SceneAudioCommands(this, () => this.finishLayerGestures());
  private readonly dialogueCommands = new SceneDialogueCommands(this, () => this.finishLayerGestures());
  private cameraTime: (() => number) | undefined;
  private actorBounds: ((id: string) => CameraViewport | undefined) | undefined;
  private readonly lockedLayers = new Map<string, Set<string>>();
  readonly images = new SceneImageRegistry();
  private readonly cameraCommands = new SceneCameraCommands(this);
  private readonly artworkCommands = new SceneArtworkCommands(
    this,
    () => this.finishLayerGestures(),
    () => this.gestures.target('image') !== null,
  );
  private readonly transitionCommands = new SceneTransitionCommands(this, () => this.finishLayerGestures());
  private groundOffsets: ReadonlyMap<string, number> = new Map();
  private groundContacts: ReadonlyMap<string, readonly ActorGroundContact[]> = new Map();
  private readonly selectedContacts = new Map<string, string>();
  private groundCharacters = new Map<string, string>();
  private groundPreviewing = false;
  showFootContacts = false;
  private issues: readonly ValidationIssue[] = [];
  private readonly snapshots: SceneSnapshotParser;

  constructor(
    private readonly validation: SceneValidationOptions = {},
    private readonly animationIds?: (manifest: string) => readonly string[] | undefined,
    private readonly retainedImageReferences?: () => Iterable<string>,
    private readonly readProjectAudio?: (id: string) => Uint8Array<ArrayBuffer> | undefined,
  ) {
    this.snapshots = new SceneSnapshotParser(validation, animationIds);
  }

  private parse(input: unknown): SceneDefinition {
    const scene = parseSceneDefinition(input, this.validation);
    if (!this.animationIds) return scene;
    const actors = new Map(scene.actors.map((actor) => [actor.id, actor]));
    for (const [index, actor] of scene.actors.entries()) {
      const animations = this.animationIds(actor.character.manifest);
      if (actor.dialogueIdle && animations && !animations.includes(actor.dialogueIdle.animation))
        throw new SceneValidationError([
          {
            severity: 'error',
            path: `actors[${index}].dialogueIdle.animation`,
            message: `Unknown animation "${actor.dialogueIdle.animation}" for Actor "${actor.id}".`,
          },
        ]);
    }
    for (const [index, action] of scene.actions.entries()) {
      const actor = actors.get(action.actorId)!;
      const animations = this.animationIds?.(actor.character.manifest);
      if (action.type === 'animation' && animations && !animations.includes(action.animation))
        throw new SceneValidationError([
          {
            severity: 'error',
            path: `actions[${index}].animation`,
            message: `Unknown animation "${action.animation}" for Actor "${actor.id}".`,
          },
        ]);
    }
    return scene;
  }

  readonly subscribe = this.notifications.subscribe;
  readonly getSnapshot = this.notifications.getSnapshot;
  readonly getAuthoredSnapshot = this.notifications.getAuthoredSnapshot;
  readonly getSelectionSnapshot = this.notifications.getSelectionSnapshot;
  readonly getPresentationSnapshot = this.notifications.getPresentationSnapshot;
  readonly subscribeAuthored = (listener: () => void): (() => void) =>
    this.notifications.subscribeRevision('authored', listener);
  readonly subscribeSelection = (listener: () => void): (() => void) =>
    this.notifications.subscribeRevision('selection', listener);
  readonly subscribePresentation = (listener: () => void): (() => void) =>
    this.notifications.subscribeRevision('presentation', listener);

  private notify(kind?: 'selection' | 'presentation'): void {
    this.notifications.publish(this.workingScene, kind);
  }
  private get entry(): SceneEntry | undefined {
    return this.selected === null ? undefined : this.entries.get(this.selected);
  }
  get sceneIds(): readonly string[] {
    return Object.freeze([...this.entries.keys()]);
  }
  get selectedSceneId(): string | null {
    return this.selected;
  }
  /** Read another retained document without changing selection, gestures or history. */
  scene(id: string): ReadonlyScene | undefined {
    return this.entries.get(id)?.working;
  }
  /** Every restorable revision keeps its project-owned dependencies alive. */
  get retainedSnapshots(): readonly ReadonlyScene[] {
    return [...this.entries.values()].flatMap((entry) => [
      entry.source,
      entry.saved,
      entry.working,
      ...entry.history.retainedSnapshots,
    ]);
  }
  /** Project membership, its checkpoint and history determine which scene owners still exist. */
  retainScenes(retained: ReadonlySet<string>): void {
    const removed = this.sceneIds.filter((id) => !retained.has(id));
    if (!removed.length) return;
    if (this.selected !== null && removed.includes(this.selected)) {
      this.finishLayerGestures();
      this.selected = null;
      this.groundOffsets = new Map();
      this.groundContacts = new Map();
      this.selectedContacts.clear();
    }
    for (const id of removed) {
      this.entries.delete(id);
      this.lockedLayers.delete(id);
      this.groundGuide.forget(id);
    }
    this.success();
  }
  get sourceScene(): ReadonlyScene | null {
    return this.entry?.source ?? null;
  }
  get workingScene(): ReadonlyScene | null {
    return this.entry?.working ?? null;
  }
  get validationIssues(): readonly ValidationIssue[] {
    return this.issues;
  }
  private isDirty(entry: SceneEntry): boolean {
    return entry.unsavedNew || !equalJsonData(entry.working, entry.saved);
  }
  get dirty(): boolean {
    return !!this.entry && this.isDirty(this.entry);
  }
  needsImportConfirmation(id: string): boolean {
    const entry = this.entries.get(id);
    return !!entry && this.isDirty(entry);
  }
  get hasUnsavedChanges(): boolean {
    return [...this.entries.values()].some((entry) => this.isDirty(entry));
  }
  get isNewScene(): boolean {
    return this.entry?.unsavedNew ?? false;
  }
  get canUndo(): boolean {
    return this.entry?.history.canUndo ?? false;
  }
  get canRedo(): boolean {
    return this.entry?.history.canRedo ?? false;
  }
  get hasOpenOperation(): boolean {
    return [...this.entries.values()].some((entry) => entry.history.inOperation);
  }

  reportError(error: unknown): false {
    this.issues = freezeData(
      error instanceof SceneValidationError
        ? [...error.issues]
        : [{ severity: 'error', message: error instanceof Error ? error.message : String(error) }],
    );
    this.notify('presentation');
    return false;
  }
  private success(): true {
    // Ground selections and measurements belong to a particular Actor/character instance.
    // Discard removed IDs before they can be reused by a different Actor.
    const actors = new Map(this.workingScene?.actors.map((actor) => [actor.id, actor.character.manifest]));
    const invalidated = new Set(
      [...this.groundCharacters].filter(([id, manifest]) => actors.get(id) !== manifest).map(([id]) => id),
    );
    for (const id of invalidated) this.selectedContacts.delete(id);
    if (invalidated.size) {
      this.groundContacts = new Map([...this.groundContacts].filter(([id]) => !invalidated.has(id)));
      this.groundOffsets = new Map([...this.groundOffsets].filter(([id]) => !invalidated.has(id)));
    }
    this.groundCharacters = actors;
    this.issues = [];
    this.notify();
    return true;
  }
  private register(scene: SceneDefinition, unsavedNew: boolean): void {
    const source = this.snapshots.parse(scene);
    const entry: SceneEntry = {
      source,
      saved: source,
      working: source,
      unsavedNew,
      cameraSelected: false,
      cameraKeyEdit: false,
      selectedCameraKey: null,
      cameraPreview: false,
      cameraOverlays: false,
      selectedImage: null,
      selectedActor: null,
      selectedAction: null,
      selectedActions: [],
      selectedTransition: null,
      selectedAudioClip: null,
      selectedDialogueLine: null,
      history: new SnapshotHistory(
        () => entry.working,
        (snapshot) => {
          entry.working = snapshot;
        },
        equalJsonData,
      ),
    };
    this.gestures.cancel();
    this.groundGuide.cancelDrag();
    this.groundOffsets = new Map();
    this.groundContacts = new Map();
    this.selectedContacts.clear();
    this.lockedLayers.delete(scene.id);
    this.entries.set(scene.id, entry);
    this.selected = scene.id;
    this.groundGuide.bind(scene.id);
  }

  createScene(options: Parameters<typeof createEmptyScene>[0]): boolean {
    try {
      const scene = createEmptyScene(options);
      if (this.entries.has(scene.id)) throw new Error(`Scene "${scene.id}" is already open.`);
      this.register(scene, true);
      return this.success();
    } catch (error) {
      return this.reportError(error);
    }
  }

  createSceneCopy(input: unknown): boolean {
    try {
      const scene = this.parse(input);
      if (this.entries.has(scene.id)) throw new Error(`Scene "${scene.id}" is already open.`);
      this.register(scene, true);
      return this.success();
    } catch (error) {
      return this.reportError(error);
    }
  }

  /** Selecting retains all documents, saved baselines and undo/redo histories. */
  selectScene(id: string): boolean {
    if (!this.entries.has(id)) return this.reportError(new Error(`Unknown scene "${id}".`));
    this.gestures.cancel();
    this.groundGuide.cancelDrag();
    if (this.selected === id) return this.success();
    this.selected = id;
    this.groundOffsets = new Map();
    this.groundContacts = new Map();
    this.selectedContacts.clear();
    this.groundGuide.bind(id);
    return this.success();
  }

  /** Only replacement of a dirty document needs consent; opening another document preserves every draft. */
  importJson(json: string, options: { confirmDiscard?: () => boolean } = {}): boolean {
    try {
      const scene = this.parse(parseSceneJson(json, this.validation));
      const replacing = this.entries.get(scene.id);
      if (replacing && this.isDirty(replacing) && !options.confirmDiscard?.()) return false;
      this.register(scene, false);
      return this.success();
    } catch (error) {
      return this.reportError(error);
    }
  }

  /** Stable document IDs are assigned at creation/import; actor IDs are authored explicitly, never regenerated. */
  replaceScene(input: unknown): boolean {
    const entry = this.entry;
    if (!entry) return this.reportError(new Error('No scene is selected.'));
    try {
      const next = this.snapshots.parse(input);
      if (next.id !== this.selected)
        throw new Error('Scene ID must remain stable; create a separate scene for a new ID.');
      entry.history.change(() => {
        entry.working = next;
      });
      return this.success();
    } catch (error) {
      return this.reportError(error);
    }
  }

  get cinematicCamera(): Readonly<CinematicCameraState> {
    return this.workingScene
      ? evaluateCameraAtTime(this.workingScene, this.cameraTime?.() ?? 0)
      : DEFAULT_CINEMATIC_CAMERA;
  }
  /** Clock ownership remains in playback. This provider never writes authored data. */
  setCameraTimeProvider(provider: (() => number) | undefined): void {
    this.cameraTime = provider;
  }
  get cameraKeyEditing(): boolean {
    return this.entry?.cameraKeyEdit ?? false;
  }
  setCameraKeyEditing(enabled: boolean): void {
    this.selectCamera();
    if (this.entry) this.entry.cameraKeyEdit = enabled;
    this.notify('presentation');
  }
  get selectedCameraKey(): { property: CameraProperty; key: Readonly<CameraKeyframe> } | null {
    const selected = this.cameraSelected && this.entry?.selectedCameraKey;
    const key = selected && this.workingScene?.cameraTracks?.[selected.property]?.find((key) => key.id === selected.id);
    return selected && key ? { property: selected.property, key } : null;
  }
  selectCameraKey(property: CameraProperty, id: string): void {
    this.selectCamera();
    if (!this.entry || !this.workingScene?.cameraTracks?.[property]?.some((key) => key.id === id)) return;
    this.entry.selectedCameraKey = { property, id };
    this.entry.cameraKeyEdit = true;
    this.notify('selection');
  }
  /** Explicit capture; channels at the same time are replaced without duplicating keys. */
  setCameraKey(time = this.cameraTime?.() ?? 0, values: Partial<CinematicCameraState> = this.cinematicCamera): boolean {
    if (this.gestures.target('camera') === null) this.finishLayerGestures();
    return this.cameraCommands.setCameraKey(time, values);
  }
  /** A cut uses the existing camera owner: each preceding channel key holds until
   * this shot's key. A time-zero baseline prevents first-key pre-roll changing the old shot.
   * All three channels and predecessor curves enter history in one validated snapshot.
   */
  setCameraCut(time = this.cameraTime?.() ?? 0, values: CinematicCameraState = this.cinematicCamera): boolean {
    this.finishLayerGestures();
    return this.cameraCommands.setCameraCut(time, values);
  }
  updateCameraKey(property: CameraProperty, id: string, patch: Partial<Omit<CameraKeyframe, 'id'>>): boolean {
    if (!this.gestures.target('cameraKey')) this.finishLayerGestures();
    return this.cameraCommands.updateCameraKey(property, id, patch);
  }
  removeCameraKey(property: CameraProperty, id: string): boolean {
    this.finishLayerGestures();
    return this.cameraCommands.removeCameraKey(property, id);
  }
  duplicateCameraKey(property: CameraProperty, id: string, time: number): boolean {
    this.finishLayerGestures();
    return this.cameraCommands.duplicateCameraKey(property, id, time);
  }
  beginCameraKeyDrag(property: CameraProperty, id: string): boolean {
    this.selectCameraKey(property, id);
    if (!this.selectedCameraKey) return false;
    this.gestures.begin('cameraKey', true, this.entry!.history);
    return true;
  }
  changeCameraKeyDrag(time: number): boolean {
    const selected = this.selectedCameraKey;
    return this.gestures.target('cameraKey') && selected
      ? this.updateCameraKey(selected.property, selected.key.id, { time })
      : false;
  }
  get cameraSelected(): boolean {
    return this.entry?.cameraSelected ?? false;
  }
  get cameraPreviewing(): boolean {
    return this.entry?.cameraPreview ?? false;
  }
  get cameraOverlays(): boolean {
    return this.entry?.cameraOverlays ?? false;
  }
  selectCamera(selected = true): void {
    this.gestures.cancel();
    if (!this.entry) return;
    this.entry.selectedTransition = null;
    this.entry.selectedAudioClip = null;
    this.entry.selectedDialogueLine = null;
    this.entry.cameraSelected = selected;
    this.entry.selectedCameraKey = null;
    if (selected) {
      this.entry.selectedImage = null;
      this.entry.selectedAction = null;
      this.entry.selectedActions = [];
    }
    this.notify('selection');
  }
  setCameraPreview(enabled: boolean): void {
    this.selectCamera(this.cameraSelected);
    this.groundGuide.cancelDrag();
    if (!this.entry) return;
    this.entry.cameraPreview = enabled;
    this.notify('presentation');
  }
  setCameraOverlays(enabled: boolean): void {
    this.cancelCameraDrag();
    this.cancelImageDrag();
    this.cancelActorDrag();
    this.groundGuide.cancelDrag();
    if (!this.entry) return;
    this.entry.cameraOverlays = enabled;
    this.notify('presentation');
  }
  updateCamera(patch: Partial<CinematicCameraState>): boolean {
    if (this.gestures.target('camera') === null) this.finishLayerGestures();
    if (!this.workingScene) return false;
    if (this.cameraKeyEditing)
      return this.setCameraKey(this.gestures.target('camera') ?? this.cameraTime?.() ?? 0, patch);
    return this.replaceScene({
      ...this.workingScene,
      camera: { ...(this.workingScene.camera ?? DEFAULT_CINEMATIC_CAMERA), ...patch },
    });
  }
  resetCamera(): boolean {
    return this.updateCamera(DEFAULT_CINEMATIC_CAMERA);
  }
  /** Measurements stay in the view; frame only the explicitly selected Actor. */
  setActorBoundsProvider(provider: ((id: string) => CameraViewport | undefined) | undefined): void {
    this.actorBounds = provider;
  }
  frameSelectedActor(): boolean {
    const actor = this.workingScene?.actors.find((actor) => actor.id === this.selectedActorId);
    if (!actor) return false;
    const bounds = this.actorBounds?.(actor.id);
    const camera =
      bounds &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        ? cameraForBounds(bounds)
        : { ...this.cinematicCamera, ...actor.position };
    return this.updateCamera(camera);
  }
  beginCameraDrag(): boolean {
    this.selectCamera();
    if (!this.entry || this.cameraPreviewing) return false;
    if (
      !this.cameraKeyEditing &&
      CAMERA_PROPERTIES.some((property) => this.workingScene?.cameraTracks?.[property]?.length)
    )
      return false;
    this.gestures.begin('camera', this.cameraTime?.() ?? 0, this.entry.history);
    return true;
  }
  moveCameraDrag(position: { x: number; y: number }): boolean {
    return this.gestures.target('camera') !== null ? this.updateCamera(position) : false;
  }
  endCameraDrag(): void {
    this.gestures.end('camera', 'cameraKey');
  }
  cancelCameraDrag(): void {
    this.gestures.cancel('camera', 'cameraKey');
  }

  get selectedImageId(): string | null {
    const id = this.entry?.selectedImage;
    return this.workingScene?.images?.some((image) => image.id === id) ? id! : null;
  }
  isLayerLocked(id: string): boolean {
    return this.lockedLayers.get(this.selectedSceneId ?? '')?.has(id) ?? false;
  }
  setLayerLocked(id: string, locked: boolean): void {
    if (!this.selectedSceneId || id === 'actors') return;
    this.cancelImageDrag();
    let locks = this.lockedLayers.get(this.selectedSceneId);
    if (!locks) this.lockedLayers.set(this.selectedSceneId, (locks = new Set()));
    if (locked) locks.add(id);
    else locks.delete(id);
    this.notify('presentation');
  }
  isImageLocked(id: string): boolean {
    const image = this.workingScene?.images?.find((image) => image.id === id);
    return !!image && this.isLayerLocked(image.layerId ?? 'background');
  }
  private finishLayerGestures(): void {
    this.gestures.end();
  }
  addLayer(): boolean {
    return this.artworkCommands.addLayer();
  }
  updateLayer(id: string, patch: Partial<Omit<SceneLayerDefinition, 'id'>>): boolean {
    return this.artworkCommands.updateLayer(id, patch);
  }
  reorderLayer(id: string, offset: -1 | 1): boolean {
    return this.artworkCommands.reorderLayer(id, offset);
  }
  /** Safe deletion: retain all elements and assets, moving artwork into Background in one history entry. */
  removeLayer(id: string): boolean {
    return this.artworkCommands.removeLayer(id);
  }
  assignImageLayer(id: string, layerId: string): boolean {
    return this.artworkCommands.assignImageLayer(id, layerId);
  }
  reorderImage(id: string, offset: -1 | 1): boolean {
    return this.artworkCommands.reorderImage(id, offset);
  }
  selectImage(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.images?.some((image) => image.id === id))) return;
    this.cancelCameraDrag();
    this.cancelActorDrag();
    this.cancelAudioDrag();
    this.cancelActionDrag();
    if (id !== this.selectedImageId) this.cancelImageDrag();
    this.entry.cameraSelected = false;
    this.entry.selectedTransition = null;
    this.entry.selectedAudioClip = null;
    this.entry.selectedDialogueLine = null;
    this.entry.selectedImage = id;
    this.entry.selectedActor = null;
    this.entry.selectedAction = null;
    this.entry.selectedActions = [];
    this.notify('selection');
  }
  addImage(reference: string): boolean {
    return this.artworkCommands.addImage(reference);
  }
  updateImage(id: string, patch: Partial<Omit<SceneImageDefinition, 'id'>>): boolean {
    return this.artworkCommands.updateImage(id, patch);
  }
  removeImage(id: string): boolean {
    return this.artworkCommands.removeImage(id);
  }
  beginImageDrag(id: string): boolean {
    if (this.isImageLocked(id)) return false;
    this.cancelImageDrag();
    this.selectImage(id);
    if (!this.entry || this.selectedImageId !== id) return false;
    this.gestures.begin('image', id, this.entry.history);
    return true;
  }
  moveImageDrag(patch: Pick<SceneImageDefinition, 'position' | 'scale'>): boolean {
    const id = this.gestures.target('image');
    return id ? this.updateImage(id, patch) : false;
  }
  endImageDrag(): void {
    this.gestures.end('image');
  }
  cancelImageDrag(): void {
    this.gestures.cancel('image');
  }
  /** Sources, checkpoints, undo, redo and active gestures all keep their binary dependencies. */
  cleanupImages(): number {
    const retained = new Set<string>(this.retainedImageReferences?.());
    for (const scene of this.retainedSnapshots) for (const image of scene.images ?? []) retained.add(image.image);
    return this.images.removeUnused(retained);
  }

  get selectedActorId(): string | null {
    const id = this.entry?.selectedActor;
    return this.workingScene?.actors.some((actor) => actor.id === id) ? id! : null;
  }
  get hasActiveGesture(): boolean {
    return this.gestures.hasActiveGesture;
  }
  selectActor(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.actors.some((actor) => actor.id === id))) return;
    this.replaceActorSelection(id);
    this.notify('selection');
  }
  private replaceActorSelection(id: string | null): void {
    const entry = this.entry!;
    this.cancelCameraDrag();
    this.cancelImageDrag();
    if (id !== this.selectedActorId) this.cancelActorDrag();
    this.cancelAudioDrag();
    this.cancelActionDrag();
    entry.selectedAction = null;
    entry.selectedActions = [];
    entry.selectedImage = null;
    entry.cameraSelected = false;
    entry.selectedTransition = null;
    entry.selectedAudioClip = null;
    entry.selectedDialogueLine = null;
    entry.selectedActor = id;
  }
  private nextActorId(stem = 'actor'): string {
    let index = 1;
    let id = `${stem}-${index}`;
    while (this.workingScene?.actors.some((actor) => actor.id === id)) id = `${stem}-${++index}`;
    return id;
  }
  addActor(manifest: string, position = { x: 0, y: 0 }): boolean {
    this.gestures.end();
    const scene = this.workingScene;
    if (!scene) return this.reportError(new Error('No scene is selected.'));
    const id = this.nextActorId();
    if (!this.replaceScene({ ...scene, actors: [...scene.actors, { id, character: { manifest }, position }] }))
      return false;
    this.selectActor(id);
    return true;
  }
  updateActor(id: string, patch: Partial<SceneActorDefinition>): boolean {
    this.gestures.end();
    const scene = this.workingScene;
    if (!scene?.actors.some((actor) => actor.id === id)) return this.reportError(new Error(`Unknown actor "${id}".`));
    const nextId = patch.id ?? id;
    const changed = this.replaceScene({
      ...scene,
      actors: scene.actors.map((actor) => (actor.id === id ? { ...actor, ...patch } : actor)),
      ...(scene.dialogue
        ? { dialogue: scene.dialogue.map((line) => (line.actorId === id ? { ...line, actorId: nextId } : line)) }
        : {}),
      actions: scene.actions.map((action) => ({
        ...action,
        actorId: action.actorId === id ? nextId : action.actorId,
        ...(action.type === 'face' && action.target.type === 'actor' && action.target.actorId === id
          ? { target: { type: 'actor', actorId: nextId } }
          : {}),
      })),
    });
    if (changed && this.entry?.selectedActor === id) this.selectActor(nextId);
    return changed;
  }
  setActorAppearance(id: string, property: 'animation' | 'skin' | 'dialogueIdle', value: string | null): boolean {
    this.gestures.end();
    const scene = this.workingScene;
    if (!scene?.actors.some((actor) => actor.id === id)) return this.reportError(new Error(`Unknown actor "${id}".`));
    return this.replaceScene({
      ...scene,
      actors: scene.actors.map((actor) => {
        if (actor.id !== id) return actor;
        const next = { ...actor };
        delete next[property];
        if (value !== null) {
          if (property === 'dialogueIdle') next.dialogueIdle = { animation: value, policy: 'overlay-snap' };
          else next[property] = value;
        }
        return next;
      }),
    });
  }
  duplicateActor(id: string): boolean {
    this.gestures.end();
    const scene = this.workingScene;
    const actor = scene?.actors.find((entry) => entry.id === id);
    if (!scene || !actor) return false;
    const nextId = this.nextActorId(id);
    if (
      !this.replaceScene({
        ...scene,
        actors: [
          ...scene.actors,
          {
            ...actor,
            id: nextId,
            position: { x: actor.position.x + 32, y: actor.position.y + 32 },
          },
        ],
      })
    )
      return false;
    this.selectActor(nextId);
    return true;
  }
  actorReferences(id: string) {
    return (
      this.workingScene?.actions.filter(
        (action) =>
          action.actorId === id ||
          (action.type === 'face' && action.target.type === 'actor' && action.target.actorId === id),
      ) ?? []
    );
  }
  removeActor(id: string, options: { removeActions?: boolean } = {}): boolean {
    this.gestures.end();
    const scene = this.workingScene;
    if (!scene?.actors.some((actor) => actor.id === id)) return false;
    const dialogue = scene.dialogue?.filter((line) => line.actorId === id) ?? [];
    if (dialogue.length)
      return this.reportError(
        new Error(
          `Actor "${id}" speaks in dialogue line(s) ${dialogue.map((line) => line.id).join(', ')}. Reassign those lines or change them to narration before removing this Actor.`,
        ),
      );
    if (this.actorReferences(id).length && !options.removeActions)
      return this.reportError(
        new Error(`Actor "${id}" is referenced by scene actions. Remove those actions explicitly first.`),
      );
    return this.replaceScene({
      ...scene,
      actors: scene.actors.filter((actor) => actor.id !== id),
      actions: scene.actions.filter(
        (action) =>
          action.actorId !== id &&
          !(action.type === 'face' && action.target.type === 'actor' && action.target.actorId === id),
      ),
    });
  }
  reorderActor(id: string, offset: -1 | 1): boolean {
    this.gestures.end();
    const scene = this.workingScene;
    if (!scene) return false;
    const actors = [...scene.actors];
    const index = actors.findIndex((actor) => actor.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= actors.length) return false;
    [actors[index], actors[target]] = [actors[target]!, actors[index]!];
    return this.replaceScene({ ...scene, actors });
  }
  beginActorDrag(id: string): boolean {
    this.gestures.cancel();
    if (!this.workingScene?.actors.some((actor) => actor.id === id)) return false;
    this.selectActor(id);
    this.gestures.begin('actor', id, this.entry!.history);
    return true;
  }
  /** Stage measurements are view state; they never enter exports or document history. */
  setActorGroundOffsets(offsets: ReadonlyMap<string, number>): void {
    const next = new Map([...offsets].filter(([, offset]) => Number.isFinite(offset)));
    if (
      next.size === this.groundOffsets.size &&
      [...next].every(([id, y]) => Math.abs(y - (this.groundOffsets.get(id) ?? NaN)) < 1e-8)
    )
      return;
    this.groundOffsets = next;
    this.notify('presentation');
  }
  get canAlignSelectedActorFeetToGround(): boolean {
    return (
      !this.groundPreviewing &&
      this.selectedActorId !== null &&
      this.actorGroundOffset(this.selectedActorId) !== undefined
    );
  }
  setGroundPreviewing(previewing: boolean): void {
    if (this.groundPreviewing === previewing) return;
    this.groundPreviewing = previewing;
    this.notify('presentation');
  }
  setActorGroundContacts(contacts: ReadonlyMap<string, readonly ActorGroundContact[]>): void {
    if (equalJsonData([...contacts], [...this.groundContacts])) return;
    this.groundContacts = contacts;
    this.notify('presentation');
  }
  get selectedActorGroundContacts(): readonly ActorGroundContact[] {
    return this.selectedActorId ? (this.groundContacts.get(this.selectedActorId) ?? []) : [];
  }
  get selectedFootContactId(): string {
    return this.selectedActorId ? (this.selectedContacts.get(this.selectedActorId) ?? '') : '';
  }
  selectFootContact(id: string): void {
    if (!this.selectedActorId || (id && !this.selectedActorGroundContacts.some((entry) => entry.id === id))) return;
    this.selectedContacts.set(this.selectedActorId, id);
    this.showFootContacts = true;
    this.notify('selection');
  }
  setFootContactsVisible(visible: boolean): void {
    this.showFootContacts = visible;
    this.notify('presentation');
  }
  private actorGroundOffset(id: string): number | undefined {
    const contacts = this.groundContacts.get(id);
    if (contacts?.length) {
      const offset = contacts.find((contact) => contact.id === this.selectedContacts.get(id))?.offset;
      return offset !== undefined && Number.isFinite(offset) ? offset : undefined;
    }
    return this.groundOffsets.get(id);
  }
  alignSelectedActorFeetToGround(): boolean {
    const actor = this.workingScene?.actors.find((actor) => actor.id === this.selectedActorId);
    const { guide, dragging } = this.groundGuide.getSnapshot();
    const offset = actor && this.actorGroundOffset(actor.id);
    if (!actor || offset === undefined || !guide.enabled || dragging || this.groundPreviewing) return false;
    return this.updateActor(actor.id, { position: { x: actor.position.x, y: guide.y - offset } });
  }
  moveActorDrag(position: { x: number; y: number }, options: { bypassGround?: boolean } = {}): boolean {
    const scene = this.workingScene;
    const id = this.gestures.target('actor');
    if (!scene || !id) return false;
    const { guide } = this.groundGuide.getSnapshot();
    const offset = this.actorGroundOffset(id);
    const initialPosition =
      guide.enabled && guide.snapEnabled && offset !== undefined && !options.bypassGround
        ? { x: position.x, y: guide.y - offset }
        : position;
    return this.replaceScene({
      ...scene,
      actors: scene.actors.map((actor) => (actor.id === id ? { ...actor, position: initialPosition } : actor)),
    });
  }
  endActorDrag(): void {
    this.gestures.end('actor');
  }
  cancelActorDrag(): void {
    this.gestures.cancel('actor');
  }

  /** Project assets remain owned by Project Workspace; standalone imports retain binaries by stable path. */
  get audioAssets(): readonly AudioAssetDefinition[] {
    return this.validation.getAudioAssets?.() ?? this.workingScene?.audioAssets ?? [];
  }
  registerAudio(reference: string, bytes: Uint8Array<ArrayBuffer>): void {
    this.audioFiles.set(reference, new Uint8Array(bytes));
  }
  readAudio(reference: string): Uint8Array<ArrayBuffer> {
    const asset = this.audioAssets.find((asset) => asset.path === reference);
    const bytes = (asset && this.readProjectAudio?.(asset.id)) ?? this.audioFiles.get(reference);
    if (!bytes) throw new Error(`Missing audio binary "${reference}". Reimport the scene with its audio files.`);
    return new Uint8Array(bytes);
  }
  get selectedDialogueLine(): Readonly<SceneDialogueLine> | null {
    return this.workingScene?.dialogue?.find((line) => line.id === this.entry?.selectedDialogueLine) ?? null;
  }
  selectDialogueLine(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.dialogue?.some((line) => line.id === id))) return;
    this.replaceActorSelection(null);
    this.entry.selectedDialogueLine = id;
    this.notify('selection');
  }
  addDialogueLine(input: Omit<SceneDialogueLine, 'id'>): boolean {
    return this.dialogueCommands.add(input);
  }
  updateDialogueLine(id: string, patch: SceneDialoguePatch): boolean {
    return this.dialogueCommands.update(id, patch);
  }
  duplicateDialogueLine(id: string): boolean {
    return this.dialogueCommands.duplicate(id);
  }
  removeDialogueLine(id: string): boolean {
    return this.dialogueCommands.remove(id);
  }

  get selectedAudioClip(): Readonly<SceneAudioClip> | null {
    return this.workingScene?.audioClips?.find((clip) => clip.id === this.entry?.selectedAudioClip) ?? null;
  }
  selectAudioClip(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.audioClips?.some((clip) => clip.id === id))) return;
    this.replaceActorSelection(null);
    this.entry.selectedAudioClip = id;
    this.notify('selection');
  }
  addAudioTrack(category: AudioCategory): boolean {
    return this.audioCommands.addTrack(category);
  }
  removeAudioTrack(id: string, options: { removeClips?: boolean } = {}): boolean {
    return this.audioCommands.removeTrack(id, options);
  }
  addAudioClip(input: Omit<SceneAudioClip, 'id'>): boolean {
    return this.audioCommands.addClip(input);
  }
  updateAudioClip(id: string, patch: Partial<Omit<SceneAudioClip, 'id'>>): boolean {
    if (!this.gestures.target('audio')) this.finishLayerGestures();
    return this.audioCommands.updateClip(id, patch);
  }
  removeAudioClip(id: string): boolean {
    return this.audioCommands.removeClip(id);
  }
  duplicateAudioClip(id: string): boolean {
    const clip = this.workingScene?.audioClips?.find((clip) => clip.id === id);
    return clip ? this.addAudioClip({ ...clip }) : false;
  }
  beginAudioDrag(id: string): boolean {
    this.selectAudioClip(id);
    if (this.selectedAudioClip?.id !== id) return false;
    this.gestures.begin('audio', id, this.entry!.history);
    return true;
  }
  changeAudioDrag(clip: SceneAudioClip): boolean {
    return this.gestures.target('audio') === clip.id ? this.audioCommands.updateClip(clip.id, clip) : false;
  }
  endAudioDrag(): void {
    this.gestures.end('audio');
  }
  cancelAudioDrag(): void {
    this.gestures.cancel('audio');
  }

  get selectedActionId(): string | null {
    const id = this.entry?.selectedAction;
    return this.workingScene?.actions.some((action) => action.id === id) ? id! : null;
  }
  get selectedTransition(): Readonly<SceneTransition> | null {
    return this.workingScene?.transitions?.find((effect) => effect.id === this.entry?.selectedTransition) ?? null;
  }
  selectTransition(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.transitions?.some((effect) => effect.id === id))) return;
    this.replaceActorSelection(null);
    this.entry.selectedTransition = id;
    this.notify('selection');
  }
  addTransition(input: Omit<SceneTransition, 'id'>): boolean {
    return this.transitionCommands.addTransition(input);
  }
  updateTransition(id: string, patch: Partial<Omit<SceneTransition, 'id'>>): boolean {
    return this.transitionCommands.updateTransition(id, patch);
  }
  removeTransition(id: string): boolean {
    return this.transitionCommands.removeTransition(id);
  }
  get selectedActionIds(): readonly string[] {
    const existing = new Set(this.workingScene?.actions.map((action) => action.id));
    return (this.entry?.selectedActions ?? []).filter((id) => existing.has(id));
  }
  selectAction(id: string | null, additive = false): void {
    const action = this.workingScene?.actions.find((action) => action.id === id);
    if (!this.entry || (id !== null && !action)) return;
    this.cancelAudioDrag();
    this.cancelImageDrag();
    this.cancelCameraDrag();
    this.cancelActorDrag();
    if (id !== this.selectedActionId) this.cancelActionDrag();
    this.entry.selectedImage = null;
    this.entry.cameraSelected = false;
    this.entry.selectedTransition = null;
    this.entry.selectedAudioClip = null;
    this.entry.selectedDialogueLine = null;
    this.entry.selectedActions =
      additive && id
        ? this.entry.selectedActions.includes(id)
          ? this.entry.selectedActions.filter((value) => value !== id)
          : [...this.entry.selectedActions, id]
        : id
          ? [id]
          : [];
    this.entry.selectedAction = this.entry.selectedActions.at(-1) ?? null;
    const primary = this.workingScene?.actions.find((value) => value.id === this.entry!.selectedAction);
    if (primary) this.entry.selectedActor = primary.actorId;
    this.notify('selection');
  }
  private nextActionId(): string {
    let index = 1;
    while (this.workingScene?.actions.some((action) => action.id === `action-${index}`)) index++;
    return `action-${index}`;
  }
  addAction(input: SceneActionInput): boolean {
    this.gestures.end();
    const scene = this.workingScene;
    if (!scene) return false;
    const id = this.nextActionId();
    if (!this.replaceScene({ ...scene, actions: [...scene.actions, { ...input, id }] })) return false;
    this.selectAction(id);
    return true;
  }
  updateAction(id: string, input: SceneActionDefinition): boolean {
    this.gestures.end();
    return this.replaceAction(id, input);
  }
  private replaceAction(id: string, input: SceneActionDefinition): boolean {
    const scene = this.workingScene;
    if (!scene?.actions.some((action) => action.id === id))
      return this.reportError(new Error(`Unknown action "${id}".`));
    if (input.id !== id) return this.reportError(new Error('Action IDs must remain stable.'));
    return this.replaceScene({ ...scene, actions: scene.actions.map((action) => (action.id === id ? input : action)) });
  }
  removeAction(id: string): boolean {
    this.gestures.end();
    const scene = this.workingScene;
    if (!scene?.actions.some((action) => action.id === id)) return false;
    return this.replaceScene({ ...scene, actions: scene.actions.filter((action) => action.id !== id) });
  }
  /** Caller supplies a valid time; duplication never silently shifts another clip. */
  duplicateAction(id: string, time: number): boolean {
    const action = this.workingScene?.actions.find((action) => action.id === id);
    return action ? this.addAction({ ...action, time }) : false;
  }
  beginActionDrag(id: string): boolean {
    this.gestures.cancel();
    if (!this.workingScene?.actions.some((action) => action.id === id)) return false;
    this.selectAction(id);
    this.gestures.begin('action', id, this.entry!.history);
    return true;
  }
  changeActionDrag(input: SceneActionDefinition): boolean {
    const id = this.gestures.target('action');
    return id ? this.replaceAction(id, input) : false;
  }
  endActionDrag(): void {
    this.gestures.end('action');
  }
  cancelActionDrag(): void {
    this.gestures.cancel('action');
  }

  updateProperties(properties: { name?: string; duration?: number }): boolean {
    this.gestures.end();
    return this.replaceScene({ ...this.workingScene, ...properties });
  }
  undo(): boolean {
    this.gestures.cancel();
    if (!this.entry?.history.undo()) return false;
    return this.success();
  }
  redo(): boolean {
    this.gestures.cancel();
    if (!this.entry?.history.redo()) return false;
    return this.success();
  }
  revertScene(options: { discardChanges?: boolean } = {}): boolean {
    const entry = this.entry;
    if (!entry || (this.dirty && !options.discardChanges)) return false;
    this.gestures.cancel();
    entry.history.change(() => {
      entry.working = entry.source;
    });
    return this.success();
  }
  exportJson(): string {
    if (!this.workingScene) throw new Error('No scene is selected.');
    return serializeSceneDefinition(this.parse(this.workingScene), {
      ...this.validation,
      images: new Set(this.images.entries.map((image) => image.reference)),
    });
  }
  validateScene(): boolean {
    try {
      this.exportJson();
      return this.success();
    } catch (error) {
      return this.reportError(error);
    }
  }
  /** Checkpoint the captured download only, even if selection/edits changed while it was being saved. */
  markSaved(snapshot: ReadonlyScene | null = this.workingScene): boolean {
    const entry = snapshot && this.entries.get(snapshot.id);
    if (!entry) return false;
    entry.saved = this.snapshots.parse(snapshot);
    entry.unsavedNew = false;
    return this.success();
  }
}

export type SceneActionInput = SceneActionDefinition extends infer Action
  ? Action extends SceneActionDefinition
    ? Omit<Action, 'id'>
    : never
  : never;
