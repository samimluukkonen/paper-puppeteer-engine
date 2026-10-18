import { equalJsonData } from '../../engine/equalJsonData.js';
import { freezeData, type DeepReadonly } from '../../engine/readonlyData.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  SceneValidationError,
  serializeSceneDefinition,
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
  readonly history: SnapshotHistory<ReadonlyScene>;
}

/** Independent scene sessions. Only validated, detached immutable authored snapshots enter history. */
export class SceneEditorDocument {
  private readonly entries = new Map<string, SceneEntry>();
  private selected: string | null = null;
  private revision = 0;
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
      history: new SnapshotHistory(
        () => entry.working,
        (snapshot) => {
          entry.working = snapshot;
        },
        equalJsonData,
      ),
    };
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

  updateProperties(properties: { name?: string; duration?: number }): boolean {
    return this.replaceScene({ ...this.workingScene, ...properties });
  }
  undo(): boolean {
    if (!this.entry?.history.undo()) return false;
    return this.success();
  }
  redo(): boolean {
    if (!this.entry?.history.redo()) return false;
    return this.success();
  }
  revertScene(options: { discardChanges?: boolean } = {}): boolean {
    const entry = this.entry;
    if (!entry || (this.dirty && !options.discardChanges)) return false;
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
