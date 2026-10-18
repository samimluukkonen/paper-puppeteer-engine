import { equalJsonData } from '../../engine/equalJsonData.js';
import { freezeData, type DeepReadonly } from '../../engine/readonlyData.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  SceneValidationError,
  serializeSceneDefinition,
  type SceneActorDefinition,
  type SceneDefinition,
  type SceneValidationOptions,
} from '../../engine/SceneDefinition.js';
import type { ValidationIssue } from '../../engine/validation.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';

export type ReadonlyScene = DeepReadonly<SceneDefinition>;
interface SceneEntry {
  readonly source: ReadonlyScene;
  saved: ReadonlyScene;
  working: ReadonlyScene;
  unsavedNew: boolean;
  selectedActor: string | null;
  readonly history: SnapshotHistory<ReadonlyScene>;
}

/** Independent scene sessions. Only validated, detached immutable authored snapshots enter history. */
export class SceneEditorDocument {
  private readonly entries = new Map<string, SceneEntry>();
  private selected: string | null = null;
  private revision = 0;
  private dragActor: string | null = null;
  private readonly listeners = new Set<() => void>();
  private issues: readonly ValidationIssue[] = [];

  constructor(private readonly validation: SceneValidationOptions = {}) {}

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
      history: new SnapshotHistory(
        () => entry.working,
        (snapshot) => {
          entry.working = snapshot;
        },
        equalJsonData,
      ),
    };
    this.cancelActorDrag();
    this.entries.set(scene.id, entry);
    this.selected = scene.id;
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
    this.cancelActorDrag();
    this.selected = id;
    return this.success();
  }

  /** Only replacement of a dirty document needs consent; opening another document preserves every draft. */
  importJson(json: string, options: { confirmDiscard?: () => boolean } = {}): boolean {
    try {
      const scene = parseSceneJson(json, this.validation);
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
      const next = freezeData(parseSceneDefinition(input, this.validation));
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
    this.endActorDrag();
    const scene = this.workingScene;
    if (!scene?.actors.some((actor) => actor.id === id)) return this.reportError(new Error(`Unknown actor "${id}".`));
    const nextId = patch.id ?? id;
    const changed = this.replaceScene({
      ...scene,
      actors: scene.actors.map((actor) => (actor.id === id ? { ...actor, ...patch } : actor)),
      actions: scene.actions.map((action) => (action.actorId === id ? { ...action, actorId: nextId } : action)),
    });
    if (changed && this.entry?.selectedActor === id) this.selectActor(nextId);
    return changed;
  }
  setActorAppearance(id: string, property: 'animation' | 'skin', value: string | null): boolean {
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
    return this.workingScene?.actions.filter((action) => action.actorId === id) ?? [];
  }
  removeActor(id: string, options: { removeActions?: boolean } = {}): boolean {
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
      actions: scene.actions.filter((action) => action.actorId !== id),
    });
  }
  reorderActor(id: string, offset: -1 | 1): boolean {
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
    this.cancelActorDrag();
    if (!this.workingScene?.actors.some((actor) => actor.id === id)) return false;
    this.selectActor(id);
    this.entry!.history.beginOperation();
    this.dragActor = id;
    return true;
  }
  moveActorDrag(position: { x: number; y: number }): boolean {
    const scene = this.workingScene;
    if (!scene || !this.dragActor) return false;
    return this.replaceScene({
      ...scene,
      actors: scene.actors.map((actor) => (actor.id === this.dragActor ? { ...actor, position } : actor)),
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

  updateProperties(properties: { name?: string; duration?: number }): boolean {
    this.endActorDrag();
    return this.replaceScene({ ...this.workingScene, ...properties });
  }
  undo(): boolean {
    this.cancelActorDrag();
    if (!this.entry?.history.undo()) return false;
    return this.success();
  }
  redo(): boolean {
    this.cancelActorDrag();
    if (!this.entry?.history.redo()) return false;
    return this.success();
  }
  revertScene(options: { discardChanges?: boolean } = {}): boolean {
    const entry = this.entry;
    if (!entry || (this.dirty && !options.discardChanges)) return false;
    this.cancelActorDrag();
    entry.history.change(() => {
      entry.working = entry.source;
    });
    return this.success();
  }
  exportJson(): string {
    if (!this.workingScene) throw new Error('No scene is selected.');
    return serializeSceneDefinition(this.workingScene, this.validation);
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
