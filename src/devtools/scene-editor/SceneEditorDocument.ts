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
  type SceneActionDefinition,
  type SceneDefinition,
  type SceneValidationOptions,
} from '../../engine/core.js';
import type {
  AudioAssetDefinition,
  SceneAudioClip,
  SceneDialogueLine,
  SceneTransition,
  ValidationIssue,
} from '../../engine/data.js';
import { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import { emptySceneReuseLibrary, parseSceneReuseLibrary, type SceneReuseLibrary } from '../shared/sceneReuse.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
import { SceneArtworkCommands, type SceneArtworkEditing } from './SceneArtworkCommands.js';
import { SceneAudioCommands, type SceneAudioEditing } from './SceneAudioCommands.js';
import { SceneCameraCommands, type SceneCameraEditing } from './SceneCameraCommands.js';
import { SceneDialogueCommands, type SceneDialogueEditing } from './SceneDialogueCommands.js';
import { SceneEditorGestures, type SceneGesture, type SceneGestureKind } from './SceneEditorGestures.js';
import { SceneEditorNotifications } from './SceneEditorNotifications.js';
import { SceneImageRegistry } from './SceneImageRegistry.js';
import {
  cameraKeyOf,
  idOf,
  selectAction,
  selectedActionIdsOf,
  selectedActorOf,
  type SceneSelection,
} from './SceneSelection.js';
import { SceneSnapshotParser } from './SceneSnapshotParser.js';
import { SceneTransitionCommands, type SceneTransitionEditing } from './SceneTransitionCommands.js';

export type ReadonlyScene = DeepReadonly<SceneDefinition>;
export interface ActorGroundContact {
  readonly id: string;
  readonly name: string;
  readonly offset: number | undefined;
}
/** What `beginDrag` can drag. A drag edits only its target, inside one history operation. */
export type SceneDragTarget =
  | { readonly kind: 'actor'; readonly id: string }
  | { readonly kind: 'image'; readonly id: string }
  | { readonly kind: 'action'; readonly id: string }
  | { readonly kind: 'audio'; readonly id: string }
  | { readonly kind: 'camera' }
  | { readonly kind: 'cameraKey'; readonly property: CameraProperty; readonly id: string };
/** The value each kind of drag proposes on every `change`. */
export interface SceneDragChanges {
  /** `bypassGround` places the Actor without snapping its feet to the ground guide. */
  actor: { readonly position: { x: number; y: number }; readonly bypassGround?: boolean };
  image: Pick<SceneImageDefinition, 'position' | 'scale'>;
  action: SceneActionDefinition;
  audio: SceneAudioClip;
  camera: { readonly x: number; readonly y: number };
  /** The key's new time. */
  cameraKey: number;
}
/**
 * One active drag. A completed drag is one history entry; a cancelled one leaves none.
 * Once the drag ends, is cancelled or is replaced by another, the handle is inert.
 */
export interface SceneDrag<Change> {
  /** Apply a proposal; false when it is invalid or this drag is no longer active. */
  change(value: Change): boolean;
  end(): void;
  cancel(): void;
}
export type SceneDragFor<Target extends SceneDragTarget> = SceneDrag<SceneDragChanges[Target['kind']]>;

interface SceneEntry {
  readonly source: ReadonlyScene;
  saved: ReadonlyScene;
  working: ReadonlyScene;
  unsavedNew: boolean;
  selection: SceneSelection;
  cameraKeyEdit: boolean;
  cameraPreview: boolean;
  cameraOverlays: boolean;
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
  private readonly finish = (unlessDragging?: SceneGestureKind): void => this.finishGestures(unlessDragging);
  /** Domain edits. Each routes through this document's validation, history and notifications. */
  readonly audio: SceneAudioEditing = new SceneAudioCommands(this, this.finish);
  readonly dialogue: SceneDialogueEditing = new SceneDialogueCommands(this, this.finish);
  private cameraTime: (() => number) | undefined;
  private actorBounds: ((id: string) => CameraViewport | undefined) | undefined;
  private readonly lockedLayers = new Map<string, Set<string>>();
  readonly images = new SceneImageRegistry();
  readonly camera: SceneCameraEditing = new SceneCameraCommands(this, this.finish, () => this.cameraTime?.() ?? 0);
  readonly artwork: SceneArtworkEditing = new SceneArtworkCommands(this, this.finish);
  readonly transitions: SceneTransitionEditing = new SceneTransitionCommands(this, this.finish);
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
      this.finishGestures();
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
      selection: null,
      cameraKeyEdit: false,
      cameraPreview: false,
      cameraOverlays: false,
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
    this.gestures.cancel();
    if (!enabled || !this.cameraSelected) this.selectCamera();
    if (this.entry) this.entry.cameraKeyEdit = enabled;
    this.notify('presentation');
  }
  get selectedCameraKey(): { property: CameraProperty; key: Readonly<CameraKeyframe> } | null {
    const selected = cameraKeyOf(this.entry?.selection ?? null);
    const key = selected && this.workingScene?.cameraTracks?.[selected.property]?.find((key) => key.id === selected.id);
    return selected && key ? { property: selected.property, key } : null;
  }
  selectCameraKey(property: CameraProperty, id: string): void {
    if (!this.entry) return;
    const exists = !!this.workingScene?.cameraTracks?.[property]?.some((key) => key.id === id);
    if (exists) this.entry.cameraKeyEdit = true;
    this.setSelection({ kind: 'camera', key: exists ? { property, id } : null });
  }
  get cameraSelected(): boolean {
    return this.entry?.selection?.kind === 'camera';
  }
  get cameraPreviewing(): boolean {
    return this.entry?.cameraPreview ?? false;
  }
  get cameraOverlays(): boolean {
    return this.entry?.cameraOverlays ?? false;
  }
  selectCamera(selected = true): void {
    if (!this.entry) return;
    this.setSelection(selected ? { kind: 'camera', key: null } : this.cameraSelected ? null : this.entry.selection);
  }
  /**
   * The single write path for selection: every select command replaces the whole value and notifies once.
   * A selection change cancels any drag that isn't of the item `next` selects.
   */
  private setSelection(next: SceneSelection): void {
    this.gestures.keepFor(next);
    this.entry!.selection = next;
    this.notify('selection');
  }
  setCameraPreview(enabled: boolean): void {
    this.gestures.cancel();
    this.groundGuide.cancelDrag();
    if (!this.entry) return;
    this.entry.cameraPreview = enabled;
    this.notify('presentation');
  }
  setCameraOverlays(enabled: boolean): void {
    this.gestures.cancel();
    this.groundGuide.cancelDrag();
    if (!this.entry) return;
    this.entry.cameraOverlays = enabled;
    this.notify('presentation');
  }
  updateCamera(patch: Partial<CinematicCameraState>): boolean {
    this.finishGestures('camera');
    if (!this.workingScene) return false;
    if (this.cameraKeyEditing)
      return this.camera.setCameraKey(this.gestures.target('camera') ?? this.cameraTime?.() ?? 0, patch);
    return this.replaceScene({
      ...this.workingScene,
      camera: { ...(this.workingScene.camera ?? DEFAULT_CINEMATIC_CAMERA), ...patch },
    });
  }
  resetCamera(): boolean {
    return this.updateCamera(DEFAULT_CINEMATIC_CAMERA);
  }
  /** Measurements stay in the view; frame only an explicitly chosen Actor. */
  setActorBoundsProvider(provider: ((id: string) => CameraViewport | undefined) | undefined): void {
    this.actorBounds = provider;
  }
  frameActor(id: string): boolean {
    const actor = this.workingScene?.actors.find((actor) => actor.id === id);
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
  get selectedImageId(): string | null {
    const id = idOf(this.entry?.selection ?? null, 'image');
    return this.workingScene?.images?.some((image) => image.id === id) ? id! : null;
  }
  isLayerLocked(id: string): boolean {
    return this.lockedLayers.get(this.selectedSceneId ?? '')?.has(id) ?? false;
  }
  setLayerLocked(id: string, locked: boolean): void {
    if (!this.selectedSceneId || id === 'actors') return;
    // Locks change what may be dragged, so no drag outlives one.
    this.gestures.cancel();
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
  /** Commit the active gesture before an unrelated edit, unless it is a drag of `unlessDragging`. */
  private finishGestures(unlessDragging?: SceneGestureKind): void {
    if (unlessDragging === undefined || this.gestures.target(unlessDragging) === null) this.gestures.end();
  }
  selectImage(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.images?.some((image) => image.id === id))) return;
    this.setSelection(id === null ? null : { kind: 'image', id });
  }
  /** Sources, checkpoints, undo, redo and active gestures all keep their binary dependencies. */
  cleanupImages(): number {
    const retained = new Set<string>(this.retainedImageReferences?.());
    for (const scene of this.retainedSnapshots) for (const image of scene.images ?? []) retained.add(image.image);
    return this.images.removeUnused(retained);
  }

  get selectedActorId(): string | null {
    const id = selectedActorOf(this.entry?.selection ?? null);
    return this.workingScene?.actors.some((actor) => actor.id === id) ? id! : null;
  }
  get hasActiveGesture(): boolean {
    return this.gestures.hasActiveGesture;
  }
  /** Cancel the active drag, for callers that don't hold its handle (Escape, unmount). */
  cancelDrag(): void {
    this.gestures.cancel();
  }
  /** Start dragging `target`, replacing any active drag; null when the target can't be dragged. */
  beginDrag<Target extends SceneDragTarget>(target: Target): SceneDragFor<Target> | null;
  beginDrag(target: SceneDragTarget): SceneDrag<never> | null {
    this.gestures.cancel();
    const gesture = this.beginGesture(target);
    if (!gesture) return null;
    const change = this.dragChange(target) as (value: unknown) => boolean;
    return {
      change: (value) => this.gestures.isActive(gesture) && change(value),
      end: () => this.gestures.release(gesture, false),
      cancel: () => this.gestures.release(gesture, true),
    };
  }
  private beginGesture(target: SceneDragTarget): SceneGesture | null {
    const scene = this.workingScene;
    if (!scene || !this.entry) return null;
    const history = this.entry.history;
    switch (target.kind) {
      case 'actor':
        if (!scene.actors.some((actor) => actor.id === target.id)) return null;
        this.selectActor(target.id);
        return this.gestures.begin('actor', target.id, history);
      case 'image':
        if (this.isImageLocked(target.id)) return null;
        this.selectImage(target.id);
        return this.selectedImageId === target.id ? this.gestures.begin('image', target.id, history) : null;
      case 'action':
        if (!scene.actions.some((action) => action.id === target.id)) return null;
        this.selectAction(target.id);
        return this.gestures.begin('action', target.id, history);
      case 'audio':
        this.selectAudioClip(target.id);
        return this.selectedAudioClip?.id === target.id ? this.gestures.begin('audio', target.id, history) : null;
      case 'camera':
        this.selectCamera();
        if (this.cameraPreviewing) return null;
        // Without key editing, a keyed camera's position is not editable.
        if (!this.cameraKeyEditing && CAMERA_PROPERTIES.some((property) => scene.cameraTracks?.[property]?.length))
          return null;
        return this.gestures.begin('camera', this.cameraTime?.() ?? 0, history);
      case 'cameraKey':
        this.selectCameraKey(target.property, target.id);
        if (!this.selectedCameraKey) return null;
        return this.gestures.begin('cameraKey', { property: target.property, id: target.id }, history);
    }
  }
  private dragChange<Target extends SceneDragTarget>(
    target: Target,
  ): (value: SceneDragChanges[Target['kind']]) => boolean;
  private dragChange(target: SceneDragTarget): (value: never) => boolean {
    switch (target.kind) {
      case 'actor':
        return (value: SceneDragChanges['actor']) => this.moveActor(target.id, value);
      case 'image':
        return (value: SceneDragChanges['image']) => this.artwork.updateImage(target.id, value);
      case 'action':
        return (value: SceneDragChanges['action']) => this.replaceAction(target.id, value);
      case 'audio':
        return (value: SceneDragChanges['audio']) => value.id === target.id && this.audio.updateClip(value.id, value);
      case 'camera':
        return (value: SceneDragChanges['camera']) => this.updateCamera(value);
      case 'cameraKey':
        return (time: SceneDragChanges['cameraKey']) =>
          this.camera.updateCameraKey(target.property, target.id, { time });
    }
  }
  selectActor(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.actors.some((actor) => actor.id === id))) return;
    this.setSelection(id === null ? null : { kind: 'actor', id });
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
    if (changed && selectedActorOf(this.entry?.selection ?? null) === id) this.selectActor(nextId);
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
  private moveActor(id: string, { position, bypassGround }: SceneDragChanges['actor']): boolean {
    const scene = this.workingScene;
    if (!scene) return false;
    const { guide } = this.groundGuide.getSnapshot();
    const offset = this.actorGroundOffset(id);
    const initialPosition =
      guide.enabled && guide.snapEnabled && offset !== undefined && !bypassGround
        ? { x: position.x, y: guide.y - offset }
        : position;
    return this.replaceScene({
      ...scene,
      actors: scene.actors.map((actor) => (actor.id === id ? { ...actor, position: initialPosition } : actor)),
    });
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
    return (
      this.workingScene?.dialogue?.find((line) => line.id === idOf(this.entry?.selection ?? null, 'dialogue')) ?? null
    );
  }
  selectDialogueLine(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.dialogue?.some((line) => line.id === id))) return;
    this.setSelection(id === null ? null : { kind: 'dialogue', id });
  }
  get selectedAudioClip(): Readonly<SceneAudioClip> | null {
    return (
      this.workingScene?.audioClips?.find((clip) => clip.id === idOf(this.entry?.selection ?? null, 'audio')) ?? null
    );
  }
  selectAudioClip(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.audioClips?.some((clip) => clip.id === id))) return;
    this.setSelection(id === null ? null : { kind: 'audio', id });
  }
  get selectedActionId(): string | null {
    const id = selectedActionIdsOf(this.entry?.selection ?? null).at(-1);
    return this.workingScene?.actions.some((action) => action.id === id) ? id! : null;
  }
  get selectedTransition(): Readonly<SceneTransition> | null {
    return (
      this.workingScene?.transitions?.find(
        (effect) => effect.id === idOf(this.entry?.selection ?? null, 'transition'),
      ) ?? null
    );
  }
  selectTransition(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.transitions?.some((effect) => effect.id === id))) return;
    this.setSelection(id === null ? null : { kind: 'transition', id });
  }
  get selectedActionIds(): readonly string[] {
    const existing = new Set(this.workingScene?.actions.map((action) => action.id));
    return selectedActionIdsOf(this.entry?.selection ?? null).filter((id) => existing.has(id));
  }
  selectAction(id: string | null, additive = false): void {
    const action = this.workingScene?.actions.find((action) => action.id === id);
    if (!this.entry || (id !== null && !action)) return;
    const actorOf = (actionId: string) => this.workingScene?.actions.find((value) => value.id === actionId)?.actorId;
    this.setSelection(selectAction(this.entry.selection, id, actorOf, additive));
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
