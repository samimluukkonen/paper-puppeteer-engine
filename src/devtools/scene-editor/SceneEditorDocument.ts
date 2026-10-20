import { equalJsonData } from '../../engine/equalJsonData.js';
import { freezeData, type DeepReadonly } from '../../engine/readonlyData.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  SceneValidationError,
  serializeSceneDefinition,
  type SceneActorDefinition,
  type SceneActionDefinition,
  type SceneDefinition,
  type SceneValidationOptions,
} from '../../engine/SceneDefinition.js';
import type { ValidationIssue } from '../../engine/validation.js';
import { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';

export type ReadonlyScene = DeepReadonly<SceneDefinition>;
interface SceneEntry {
  readonly source: ReadonlyScene;
  saved: ReadonlyScene;
  working: ReadonlyScene;
  unsavedNew: boolean;
  selectedActor: string | null;
  selectedAction: string | null;
  readonly history: SnapshotHistory<ReadonlyScene>;
}

/** Independent scene sessions. Only validated, detached immutable authored snapshots enter history. */
export class SceneEditorDocument {
  readonly groundGuide = new GroundGuideWorkspace('scene-world', undefined, true);
  private readonly entries = new Map<string, SceneEntry>();
  private selected: string | null = null;
  private revision = 0;
  private dragAction: string | null = null;
  private dragActor: string | null = null;
  private groundOffsets: ReadonlyMap<string, number> = new Map();
  private readonly listeners = new Set<() => void>();
  private issues: readonly ValidationIssue[] = [];

  constructor(
    private readonly validation: SceneValidationOptions = {},
    private readonly animationIds?: (manifest: string) => readonly string[] | undefined,
  ) {}

  private parse(input: unknown): SceneDefinition {
    const scene = parseSceneDefinition(input, this.validation);
    if (!this.animationIds) return scene;
    const actors = new Map(scene.actors.map((actor) => [actor.id, actor]));
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

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): number => this.revision;
  private notify(): void {
    this.revision++;
    // oxlint-disable-next-line unicorn/no-useless-spread -- Subscription changes apply to the next notification.
    for (const listener of [...this.listeners]) listener();
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

  reportError(error: unknown): false {
    this.issues = freezeData(
      error instanceof SceneValidationError
        ? [...error.issues]
        : [{ severity: 'error', message: error instanceof Error ? error.message : String(error) }],
    );
    this.notify();
    return false;
  }
  private success(): true {
    this.issues = [];
    this.notify();
    return true;
  }
  private register(scene: SceneDefinition, unsavedNew: boolean): void {
    assertJsonExportSize(scene);
    const source = freezeData(scene);
    const entry: SceneEntry = {
      source,
      saved: source,
      working: source,
      unsavedNew,
      selectedActor: null,
      selectedAction: null,
      history: new SnapshotHistory(
        () => entry.working,
        (snapshot) => {
          entry.working = snapshot;
        },
        equalJsonData,
      ),
    };
    this.cancelActionDrag();
    this.cancelActorDrag();
    this.groundGuide.cancelDrag();
    this.groundOffsets = new Map();
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

  /** Selecting retains all documents, saved baselines and undo/redo histories. */
  selectScene(id: string): boolean {
    if (!this.entries.has(id)) return this.reportError(new Error(`Unknown scene "${id}".`));
    this.cancelActionDrag();
    this.cancelActorDrag();
    this.groundGuide.cancelDrag();
    this.selected = id;
    this.groundOffsets = new Map();
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
      const next = freezeData(this.parse(input));
      if (next.id !== this.selected)
        throw new Error('Scene ID must remain stable; create a separate scene for a new ID.');
      // Retain the shared bounded JSON export/import contract before installing a snapshot.
      assertJsonExportSize(next);
      entry.history.change(() => {
        entry.working = next;
      });
      return this.success();
    } catch (error) {
      return this.reportError(error);
    }
  }

  get selectedActorId(): string | null {
    const id = this.entry?.selectedActor;
    return this.workingScene?.actors.some((actor) => actor.id === id) ? id! : null;
  }
  selectActor(id: string | null): void {
    if (!this.entry || (id !== null && !this.workingScene?.actors.some((actor) => actor.id === id))) return;
    if (id !== this.selectedActorId) this.cancelActorDrag();
    this.cancelActionDrag();
    this.entry.selectedAction = null;
    this.entry.selectedActor = id;
    this.notify();
  }
  private nextActorId(stem = 'actor'): string {
    let index = 1;
    let id = `${stem}-${index}`;
    while (this.workingScene?.actors.some((actor) => actor.id === id)) id = `${stem}-${++index}`;
    return id;
  }
  addActor(manifest: string, position = { x: 0, y: 0 }): boolean {
    this.endActionDrag();
    this.endActorDrag();
    const scene = this.workingScene;
    if (!scene) return this.reportError(new Error('No scene is selected.'));
    const id = this.nextActorId();
    if (!this.replaceScene({ ...scene, actors: [...scene.actors, { id, character: { manifest }, position }] }))
      return false;
    this.selectActor(id);
    return true;
  }
  updateActor(id: string, patch: Partial<SceneActorDefinition>): boolean {
    this.endActionDrag();
    this.endActorDrag();
    const scene = this.workingScene;
    if (!scene?.actors.some((actor) => actor.id === id)) return this.reportError(new Error(`Unknown actor "${id}".`));
    const nextId = patch.id ?? id;
    const changed = this.replaceScene({
      ...scene,
      actors: scene.actors.map((actor) => (actor.id === id ? { ...actor, ...patch } : actor)),
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
  setActorAppearance(id: string, property: 'animation' | 'skin', value: string | null): boolean {
    this.endActionDrag();
    this.endActorDrag();
    const scene = this.workingScene;
    if (!scene?.actors.some((actor) => actor.id === id)) return this.reportError(new Error(`Unknown actor "${id}".`));
    return this.replaceScene({
      ...scene,
      actors: scene.actors.map((actor) => {
        if (actor.id !== id) return actor;
        const next = { ...actor };
        delete next[property];
        if (value !== null) next[property] = value;
        return next;
      }),
    });
  }
  duplicateActor(id: string): boolean {
    this.endActionDrag();
    this.endActorDrag();
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
    this.endActionDrag();
    this.endActorDrag();
    const scene = this.workingScene;
    if (!scene?.actors.some((actor) => actor.id === id)) return false;
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
    this.endActionDrag();
    this.endActorDrag();
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
    this.cancelActionDrag();
    this.cancelActorDrag();
    if (!this.workingScene?.actors.some((actor) => actor.id === id)) return false;
    this.selectActor(id);
    this.entry!.history.beginOperation();
    this.dragActor = id;
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
    this.notify();
  }
  get canAlignSelectedActorFeetToGround(): boolean {
    return this.selectedActorId !== null && this.groundOffsets.has(this.selectedActorId);
  }
  alignSelectedActorFeetToGround(): boolean {
    const actor = this.workingScene?.actors.find((actor) => actor.id === this.selectedActorId);
    const { guide, dragging } = this.groundGuide.getSnapshot();
    const offset = actor && this.groundOffsets.get(actor.id);
    if (!actor || offset === undefined || !guide.enabled || dragging) return false;
    return this.updateActor(actor.id, { position: { x: actor.position.x, y: guide.y - offset } });
  }
  moveActorDrag(position: { x: number; y: number }, options: { bypassGround?: boolean } = {}): boolean {
    const scene = this.workingScene;
    if (!scene || !this.dragActor) return false;
    const { guide } = this.groundGuide.getSnapshot();
    const offset = this.groundOffsets.get(this.dragActor);
    const initialPosition =
      guide.enabled && guide.snapEnabled && offset !== undefined && !options.bypassGround
        ? { x: position.x, y: guide.y - offset }
        : position;
    return this.replaceScene({
      ...scene,
      actors: scene.actors.map((actor) =>
        actor.id === this.dragActor ? { ...actor, position: initialPosition } : actor,
      ),
    });
  }
  endActorDrag(): void {
    if (!this.dragActor) return;
    this.dragActor = null;
    this.entry?.history.endOperation();
    this.notify();
  }
  cancelActorDrag(): void {
    if (!this.dragActor) return;
    this.dragActor = null;
    this.entry?.history.cancelOperation();
    this.notify();
  }

  get selectedActionId(): string | null {
    const id = this.entry?.selectedAction;
    return this.workingScene?.actions.some((action) => action.id === id) ? id! : null;
  }
  selectAction(id: string | null): void {
    const action = this.workingScene?.actions.find((action) => action.id === id);
    if (!this.entry || (id !== null && !action)) return;
    this.cancelActorDrag();
    if (id !== this.selectedActionId) this.cancelActionDrag();
    this.entry.selectedAction = id;
    if (action) this.entry.selectedActor = action.actorId;
    this.notify();
  }
  private nextActionId(): string {
    let index = 1;
    while (this.workingScene?.actions.some((action) => action.id === `action-${index}`)) index++;
    return `action-${index}`;
  }
  addAction(input: SceneActionInput): boolean {
    this.endActorDrag();
    this.endActionDrag();
    const scene = this.workingScene;
    if (!scene) return false;
    const id = this.nextActionId();
    if (!this.replaceScene({ ...scene, actions: [...scene.actions, { ...input, id }] })) return false;
    this.selectAction(id);
    return true;
  }
  updateAction(id: string, input: SceneActionDefinition): boolean {
    this.endActorDrag();
    this.endActionDrag();
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
    this.endActorDrag();
    this.endActionDrag();
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
    this.cancelActorDrag();
    this.cancelActionDrag();
    if (!this.workingScene?.actions.some((action) => action.id === id)) return false;
    this.selectAction(id);
    this.entry!.history.beginOperation();
    this.dragAction = id;
    return true;
  }
  changeActionDrag(input: SceneActionDefinition): boolean {
    return this.dragAction ? this.replaceAction(this.dragAction, input) : false;
  }
  endActionDrag(): void {
    if (!this.dragAction) return;
    this.dragAction = null;
    this.entry?.history.endOperation();
    this.notify();
  }
  cancelActionDrag(): void {
    if (!this.dragAction) return;
    this.dragAction = null;
    this.entry?.history.cancelOperation();
    this.notify();
  }

  updateProperties(properties: { name?: string; duration?: number }): boolean {
    this.endActionDrag();
    this.endActorDrag();
    return this.replaceScene({ ...this.workingScene, ...properties });
  }
  undo(): boolean {
    this.cancelActionDrag();
    this.cancelActorDrag();
    if (!this.entry?.history.undo()) return false;
    return this.success();
  }
  redo(): boolean {
    this.cancelActionDrag();
    this.cancelActorDrag();
    if (!this.entry?.history.redo()) return false;
    return this.success();
  }
  revertScene(options: { discardChanges?: boolean } = {}): boolean {
    const entry = this.entry;
    if (!entry || (this.dirty && !options.discardChanges)) return false;
    this.cancelActionDrag();
    this.cancelActorDrag();
    entry.history.change(() => {
      entry.working = entry.source;
    });
    return this.success();
  }
  exportJson(): string {
    if (!this.workingScene) throw new Error('No scene is selected.');
    return serializeSceneDefinition(this.parse(this.workingScene), this.validation);
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
    entry.saved = freezeData(parseSceneDefinition(snapshot, this.validation));
    entry.unsavedNew = false;
    return this.success();
  }
}

export type SceneActionInput = SceneActionDefinition extends infer Action
  ? Action extends SceneActionDefinition
    ? Omit<Action, 'id'>
    : never
  : never;
