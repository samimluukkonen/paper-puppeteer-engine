import {
  ANIMATION_FORMAT_VERSION,
  AnimationValidationError,
  assetFilename,
  type ValidationIssue,
} from '../../engine/core.js';
import type { AnimationClip, PoseDefinition, DeepReadonly, Rig } from '../../engine/data.js';
import { equalEditorData, freezeData } from '../shared/editorData.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
import { importAnimationJson } from './animationImport.js';
import { serializeAnimation, type AnimationExportResult } from './animationSerialization.js';
import { createAnimationVariation, type AnimationVariationOptions } from './animationVariation.js';
import { createEmptyAnimation, type NewAnimationOptions } from './createEmptyAnimation.js';
import { inspectEditorAnimation, type ReadonlyAnimation } from './validatedAnimation.js';

export type { ReadonlyAnimation } from './validatedAnimation.js';
type AnimationEntry = {
  source: ReadonlyAnimation | null;
  saved: ReadonlyAnimation | null;
  issues: readonly ValidationIssue[];
  path?: string;
  unsavedNew?: boolean;
  working?: ReadonlyAnimation | null;
  history?: SnapshotHistory<ReadonlyAnimation | null>;
};

export interface AnimationEditorStateOptions {
  characterId?: string;
  poses?: readonly DeepReadonly<PoseDefinition>[];
  /** Original manifest paths by clip name; omitted entries export using the clip name. */
  animationPaths?: Readonly<Record<string, string>>;
}

export interface AnimationImportOptions {
  /** UI adapters can confirm loss of dirty edits after validation, before installing a new session. */
  confirmDiscard?: () => boolean;
}

/** Owns validated authored snapshots, saved baselines and history independently of editor navigation. */
export class AnimationEditorDocument {
  /** Called after validation and before replacing a shared clip; rejection preserves every session. */
  replacementGuard: ((name: string) => boolean) | undefined;
  private readonly animations = new Map<string, AnimationEntry>();
  private ids: readonly string[] = Object.freeze([]);
  private source: ReadonlyAnimation | null = null;
  private working: ReadonlyAnimation | null = null;
  private selectedId: string | null = null;
  private saved: ReadonlyAnimation | null = null;
  private cachedDirty: boolean | undefined;
  private issues: readonly ValidationIssue[] = [];
  private history = this.createHistory();
  constructor(
    public rig?: Rig,
    animations: readonly AnimationClip[] = [],
    options: AnimationEditorStateOptions = {},
  ) {
    for (const animation of animations) {
      if (this.animations.has(animation.name)) throw new Error(`Animation "${animation.name}" is already registered.`);
      const file = this.inspect({ ...animation, version: ANIMATION_FORMAT_VERSION });
      const path =
        options.animationPaths && Object.hasOwn(options.animationPaths, animation.name)
          ? options.animationPaths[animation.name]
          : undefined;
      this.animations.set(animation.name, {
        source: file,
        saved: file,
        issues: this.issues,
        ...(path === undefined ? {} : { path }),
      });
    }
    this.ids = Object.freeze([...this.animations.keys()]);
    this.issues = [];
  }

  get animationIds(): readonly string[] {
    return this.ids;
  }
  get selectedAnimationId(): string | null {
    return this.selectedId;
  }
  get selectedAnimationFilename(): string | undefined {
    if (this.selectedId === null) return undefined;
    const fallback = `${this.selectedId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
    return assetFilename(this.animations.get(this.selectedId)?.path, fallback);
  }
  get sourceAnimation(): ReadonlyAnimation | null {
    return this.source;
  }
  get workingAnimation(): ReadonlyAnimation | null {
    return this.working;
  }
  isNewAnimation(id: string | null = this.selectedId): boolean {
    return id !== null && !!this.animations.get(id)?.unsavedNew;
  }
  get dirty(): boolean {
    if (this.isNewAnimation()) return true;
    this.cachedDirty ??= !equalEditorData(this.working, this.saved);
    return this.cachedDirty;
  }
  get hasUnsavedChanges(): boolean {
    return (
      this.dirty ||
      [...this.animations.entries()].some(
        ([id, entry]) =>
          id !== this.selectedId &&
          (entry.unsavedNew || (entry.working !== undefined && !equalEditorData(entry.working, entry.saved))),
      )
    );
  }

  get validationIssues(): readonly ValidationIssue[] {
    return this.issues;
  }
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }
  get historyLength(): number {
    return this.history.length;
  }

  reportIssues(issues: readonly ValidationIssue[]): void {
    this.issues = freezeData(issues);
  }

  reportError(error: unknown): void {
    this.reportIssues(
      error instanceof AnimationValidationError
        ? error.issues
        : [{ severity: 'error', message: error instanceof Error ? error.message : String(error) }],
    );
  }

  inspect(input: unknown): ReadonlyAnimation | null {
    if (!this.rig) {
      this.issues = [{ severity: 'error', message: 'Load a character before selecting an animation.' }];
      return null;
    }
    const result = inspectEditorAnimation(input, this.rig);
    this.issues = freezeData(result.issues);
    if (!result.data) return null;
    return result.data;
  }

  /** All committed session clips plus the current authored snapshot; no selection/history changes. */
  packageAnimations(): readonly ReadonlyAnimation[] {
    return [...this.animations.entries()].flatMap(([id, entry]) => {
      const clip = id === this.selectedId ? this.working : (entry.working ?? entry.saved);
      return clip ? [clip] : [];
    });
  }

  /** Failed selections preserve the working copy; callers may explicitly discard authored changes. */
  selectAnimation(id: string | null, options: { discardChanges?: boolean; keepChanges?: boolean } = {}): boolean {
    if (this.dirty && !options.discardChanges && !options.keepChanges) {
      this.issues = [
        { severity: 'error', message: 'Unsaved animation changes; download, discard, or undo edits before selecting.' },
      ];
      return false;
    }
    const entry = id === null ? undefined : this.animations.get(id);
    if (id !== null && !entry?.source) {
      this.issues = entry?.issues ?? [{ severity: 'error', message: `Animation "${id}" is missing.` }];
      return false;
    }
    // The active document's latest snapshot lives on this owner until navigation.
    // Re-selecting it must not resurrect an older saved/inactive-session snapshot.
    const next =
      id === this.selectedId
        ? options.discardChanges
          ? this.saved
          : this.working
        : (entry?.working ?? entry?.saved ?? null);
    if (next && !this.inspect(next)) return false;
    if (options.discardChanges && this.saved && !this.inspect(this.saved)) return false;
    const previous = this.selectedId === null ? undefined : this.animations.get(this.selectedId);
    if (previous) {
      previous.working = options.discardChanges ? this.saved : this.working;
      if (options.discardChanges) delete previous.history;
      else previous.history = this.history;
    }
    this.source = entry?.source ?? null;
    // Edits replace immutable snapshots; retain their identity for validation and preview caches.
    this.working = next;
    this.selectedId = id;
    this.issues = [];
    this.saved = entry?.saved ?? null;
    this.cachedDirty = this.working === this.saved ? false : undefined;
    this.history = options.keepChanges ? (entry?.history ?? this.createHistory()) : this.createHistory();
    return true;
  }

  /** Validate completely before registering; creation preserves every other clip and its history. */
  createAnimation(options: NewAnimationOptions): boolean {
    let animation: ReadonlyAnimation;
    try {
      if (this.animations.has(options.name)) throw new Error(`Animation "${options.name}" is already registered.`);
      animation = createEmptyAnimation(this.rig, options);
    } catch (error) {
      this.reportError(error);
      return false;
    }
    return this.registerNewAnimation(animation);
  }

  /** Register detached generated data with the same unsaved-document semantics as New Animation. */
  createDerivedAnimation(input: AnimationClip): boolean {
    const animation = this.inspect({ ...input, version: ANIMATION_FORMAT_VERSION });
    if (!animation) return false;
    if (this.animations.has(animation.name)) {
      this.reportError(new Error(`Animation "${animation.name}" is already registered.`));
      return false;
    }
    return this.registerNewAnimation(animation);
  }

  /** Copy the current committed working snapshot, including unsaved authored edits. */
  createVariation(options: AnimationVariationOptions): boolean {
    try {
      if (!this.working || !this.rig) throw new Error('Select a valid source animation first.');
      if (this.animations.has(options.name)) throw new Error(`Animation "${options.name}" is already registered.`);
      return this.registerNewAnimation(createAnimationVariation(this.working, this.rig, options));
    } catch (error) {
      this.reportError(error);
      return false;
    }
  }

  private registerNewAnimation(animation: ReadonlyAnimation): boolean {
    const previous = this.selectedId === null ? undefined : this.animations.get(this.selectedId);
    if (previous) {
      previous.working = this.working;
      previous.history = this.history;
    }
    this.animations.set(animation.name, { source: animation, saved: animation, issues: [], unsavedNew: true });
    this.ids = Object.freeze([...this.animations.keys()]);
    this.selectedId = animation.name;
    this.source = animation;
    this.working = animation;
    this.saved = animation;
    this.cachedDirty = false;
    this.issues = [];
    this.history = this.createHistory();
    return true;
  }

  /** Recover an absent document with its original source and one undoable authored snapshot. */
  recoverAnimation(sourceInput: unknown, draftInput: unknown): boolean {
    const source = this.inspect(sourceInput);
    const draft = this.inspect(draftInput);
    if (!source || !draft || source.name !== draft.name || this.animations.has(source.name)) return false;
    // Validate both snapshots before registering; importing retains every other clip's authored state.
    if (!this.importJson(JSON.stringify(source))) return false;
    this.animations.get(source.name)!.unsavedNew = true;
    return this.install(draft);
  }

  /** Import starts a clean session; rejection changes diagnostics only. */
  importJson(json: string, options: AnimationImportOptions = {}): boolean {
    const result = importAnimationJson(json, this.rig);
    if (!result.success) {
      this.reportIssues(result.issues);
      return false;
    }
    const replacing = this.animations.get(result.data.name);
    const replacingDirty =
      replacing?.unsavedNew ||
      (replacing?.working !== undefined && !equalEditorData(replacing.working, replacing.saved));
    if ((this.dirty || replacingDirty) && options.confirmDiscard && !options.confirmDiscard()) return false;
    if (replacing && this.replacementGuard && !this.replacementGuard(result.data.name)) {
      this.reportIssues([{ severity: 'warning', message: 'Replacement cancelled. Referenced animation retained.' }]);
      return false;
    }
    if (this.selectedId !== result.data.name) {
      const current = this.selectedId === null ? undefined : this.animations.get(this.selectedId);
      if (current) {
        current.working = this.working;
        current.history = this.history;
      }
    }
    const source = result.data;
    const working = source;
    const path = this.animations.get(source.name)?.path;
    this.animations.set(source.name, {
      source,
      saved: working,
      issues: [],
      ...(path === undefined ? {} : { path }),
    });
    if (!this.ids.includes(source.name)) this.ids = Object.freeze([...this.animations.keys()]);
    this.source = source;
    this.working = working;
    this.saved = working;
    this.selectedId = source.name;
    this.issues = [];
    this.cachedDirty = false;
    this.history = this.createHistory();
    return true;
  }

  /** Restore the immutable loaded/imported source locally, even after an export checkpoint. */
  revertAnimation(options: { discardChanges?: boolean } = {}): boolean {
    if (!this.source || (this.dirty && !options.discardChanges)) return false;
    if (!this.inspect(this.source)) return false;
    if (
      this.replacementGuard &&
      !equalEditorData(this.source, this.working) &&
      !this.replacementGuard(this.source.name)
    )
      return false;
    this.working = this.source;
    // Reverting an unexported document keeps its New / Unsaved status.
    if (!this.isNewAnimation()) this.markSaved();
    this.cachedDirty = undefined;
    this.history = this.createHistory();
    return true;
  }

  /** Internal edits have already validated their changes and retain immutable unchanged branches. */
  install(next: ReadonlyAnimation): boolean {
    this.issues = [];
    if (next.name !== this.selectedId) {
      this.issues = [
        {
          severity: 'error',
          path: 'name',
          message: `Animation name must remain "${this.selectedId}"; renaming is not supported.`,
        },
      ];
      return false;
    }
    try {
      assertJsonExportSize(next);
    } catch (error) {
      this.reportError(error);
      return false;
    }
    if (!equalEditorData(this.working, next)) {
      this.history.change(() => {
        this.working = next;
        this.cachedDirty = undefined;
      });
    }
    return true;
  }

  /** Export committed authored data only; drafts, selection, history and preview preferences stay local. */
  exportAnimation(): AnimationExportResult {
    if (!this.working || !this.rig)
      return { success: false, issues: [{ severity: 'error', message: 'No animation is selected.' }] };
    return serializeAnimation(this.working, this.rig);
  }

  exportJson(): string {
    if (!this.working || !this.rig) throw new Error('No animation is selected.');
    const result = this.exportAnimation();
    if (!result.success) throw new AnimationValidationError(result.issues);
    return result.json;
  }

  markSaved(snapshot: ReadonlyAnimation | null = this.working): void {
    const entry = this.selectedId === null ? undefined : this.animations.get(this.selectedId);
    if (entry) {
      entry.saved = snapshot;
      if (snapshot) entry.unsavedNew = false;
    }
    this.saved = snapshot;
    this.cachedDirty = undefined;
    this.issues = [];
  }

  private createHistory(): SnapshotHistory<ReadonlyAnimation | null> {
    return new SnapshotHistory(
      () => this.working,
      (entry) => {
        if (entry && !this.inspect(entry))
          throw new Error(
            'Cannot restore animation references after rig changes. Restore the required rig constraints/bones first.',
          );
        this.working = entry;
        this.cachedDirty = undefined;
      },
      equalEditorData,
    );
  }

  undo(): boolean {
    return this.restoreHistory(() => this.history.undo());
  }
  redo(): boolean {
    return this.restoreHistory(() => this.history.redo());
  }
  private restoreHistory(restore: () => boolean): boolean {
    try {
      const changed = restore();
      if (changed) this.issues = [];
      return changed;
    } catch (error) {
      this.reportError(error);
      return false;
    }
  }
}
