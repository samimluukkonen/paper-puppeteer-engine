import type { AnimationClip } from '../../engine/AnimationClip.js';
import {
  ANIMATION_FORMAT_VERSION,
  AnimationValidationError,
  inspectAnimationDefinition,
  parseAnimationClip,
  type ValidationIssue,
} from '../../engine/externalData.js';
import type { Rig } from '../../engine/Rig.js';
import { equalEditorData, freezeData, type ReadonlyEditorData } from '../shared/editorData.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';

/** Same external file fields; event data remains unknown to callers and is validated as JSON before ownership. */
export type ReadonlyAnimation = ReadonlyEditorData<AnimationClip> & {
  readonly version: typeof ANIMATION_FORMAT_VERSION;
};
type AnimationEntry = {
  source: ReadonlyAnimation | null;
  saved: ReadonlyAnimation | null;
  issues: readonly ValidationIssue[];
  path?: string;
};

export interface AnimationEditorStateOptions {
  /** Original manifest paths by clip name; omitted entries export using the clip name. */
  animationPaths?: Readonly<Record<string, string>>;
}

/** Owns validated authored snapshots, saved baselines and history independently of editor navigation. */
export class AnimationEditorDocument {
  private readonly animations = new Map<string, AnimationEntry>();
  private source: ReadonlyAnimation | null = null;
  private working: ReadonlyAnimation | null = null;
  private selectedId: string | null = null;
  private saved: ReadonlyAnimation | null = null;
  private cachedDirty: boolean | undefined;
  private issues: readonly ValidationIssue[] = [];
  private history = this.createHistory();
  constructor(
    readonly rig?: Rig,
    animations: readonly AnimationClip[] = [],
    options: AnimationEditorStateOptions = {},
  ) {
    for (const animation of animations) {
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
    this.issues = [];
  }

  get animationIds(): readonly string[] {
    return [...this.animations.keys()];
  }
  get selectedAnimationId(): string | null {
    return this.selectedId;
  }
  get selectedAnimationFilename(): string | undefined {
    if (this.selectedId === null) return undefined;
    const fallback = `${this.selectedId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
    const path = this.animations.get(this.selectedId)?.path;
    if (!path) return fallback;
    const basename = new URL(path, 'https://character.invalid/').pathname.split('/').at(-1);
    if (!basename) return fallback;
    // Preserve literal percent signs as well as paths with URL-encoded filenames.
    try {
      return decodeURIComponent(basename);
    } catch {
      return basename;
    }
  }
  get sourceAnimation(): ReadonlyAnimation | null {
    return this.source;
  }
  get workingAnimation(): ReadonlyAnimation | null {
    return this.working;
  }
  get dirty(): boolean {
    this.cachedDirty ??= !equalEditorData(this.working, this.saved);
    return this.cachedDirty;
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
    const result = inspectAnimationDefinition(input, this.rig);
    this.issues = freezeData(result.issues);
    if (!result.data) return null;
    // The shared validator checks JSON compatibility and rig references before any clone is installed.
    return freezeData({ ...result.data, version: ANIMATION_FORMAT_VERSION });
  }

  /** Failed selections preserve the working copy; callers may explicitly discard authored changes. */
  selectAnimation(id: string | null, options: { discardChanges?: boolean } = {}): boolean {
    if (this.dirty && !options.discardChanges) {
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
    this.source = entry?.source ?? null;
    this.working = entry?.saved ? freezeData(structuredClone(entry.saved)) : null;
    this.selectedId = id;
    this.issues = [];
    this.saved = this.working;
    this.cachedDirty = false;
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
    if (!equalEditorData(this.working, next)) {
      this.history.change(() => {
        this.working = next;
        this.cachedDirty = undefined;
      });
    }
    return true;
  }

  /** Export committed authored data only; drafts, selection, history and preview preferences stay local. */
  exportJson(): string {
    if (!this.working || !this.rig) throw new Error('No animation is selected.');
    const animation = parseAnimationClip(this.working, this.rig);
    return `${JSON.stringify({ version: ANIMATION_FORMAT_VERSION, ...animation }, null, 2)}\n`;
  }

  markSaved(): void {
    const entry = this.selectedId === null ? undefined : this.animations.get(this.selectedId);
    if (entry) entry.saved = this.working;
    this.saved = this.working;
    this.cachedDirty = false;
    this.issues = [];
  }

  private createHistory(): SnapshotHistory<ReadonlyAnimation | null> {
    return new SnapshotHistory(
      () => this.working,
      (entry) => {
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
    const changed = restore();
    if (changed) this.issues = [];
    return changed;
  }
}
