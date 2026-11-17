import type { Rig } from '../../engine/data.js';
import { Subscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import type { AnimationVariationOptions } from './animationVariation.js';

const unavailable = 'Select a valid source animation first.';

/** One bridge per workspace. A dialog is pinned to its source snapshot and session. */
export class AnimationVariationController {
  private state: AnimationEditorState | undefined;
  private release: (() => void) | undefined;
  private readonly subscribers = new Subscribers({ label: 'Variation listeners failed.' });
  private draft: { source: ReadonlyAnimation; revision: number; rig: Rig | undefined } | undefined;
  private snapshot = {
    reason: unavailable,
    source: null as ReadonlyAnimation | null,
    revision: 0,
    rig: undefined as Rig | undefined,
  };
  readonly subscribe = this.subscribers.subscribe;
  readonly getSnapshot = () => this.snapshot;

  bind(state: AnimationEditorState): void {
    this.unbind();
    this.state = state;
    this.release = state.subscribe(() => this.refresh());
    this.refresh();
  }

  private refresh(): void {
    const state = this.state;
    const source = state?.workingAnimation ?? null;
    const revision = state?.sessionRevision ?? 0;
    const rig = state?.rig;
    const reason =
      !source || !state?.rig
        ? unavailable
        : !state.animationAuthoringEnabled
          ? 'Switch to Animation mode to create a variation.'
          : state.hasPendingAnimationEdits
            ? 'Commit or cancel temporary edits before creating a variation.'
            : '';
    if (
      source === this.snapshot.source &&
      revision === this.snapshot.revision &&
      reason === this.snapshot.reason &&
      rig === this.snapshot.rig
    )
      return;
    this.snapshot = { reason, source, revision, rig };
    if (
      this.draft &&
      (source !== this.draft.source || revision !== this.draft.revision || rig !== this.draft.rig || reason)
    )
      this.cancel();
    this.subscribers.notify();
  }

  begin(): string {
    if (this.snapshot.reason || !this.snapshot.source || !this.state) return '';
    this.cancel();
    this.draft = { source: this.snapshot.source, revision: this.snapshot.revision, rig: this.snapshot.rig };
    const stem = this.snapshot.source.name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^[^a-zA-Z0-9]+/, '') || 'animation';
    const base = `${stem}-variation`;
    let name = base;
    for (let suffix = 2; this.state.animationIds.includes(name); suffix++) name = `${base}-${suffix}`;
    return name;
  }

  private get reason(): string {
    return this.snapshot.reason || (!this.draft ? 'Source changed. Reopen Create Variation.' : '');
  }

  preview(options: AnimationVariationOptions, progress: number): string {
    if (this.reason || !this.state) return this.reason || unavailable;
    try {
      this.state.previewVariation(options, progress);
      return '';
    } catch (error) {
      this.state.cancelVariationPreview();
      return error instanceof Error ? error.message : String(error);
    }
  }

  create(options: AnimationVariationOptions): string {
    if (this.reason || !this.state) return this.reason || unavailable;
    return this.state.createVariation(options)
      ? ''
      : this.state.validationIssues.map((issue) => issue.message).join('\n') || 'Could not register the variation.';
  }

  cancel(): void {
    this.draft = undefined;
    this.cancelPreview();
  }

  cancelPreview(): void {
    this.state?.cancelVariationPreview();
  }

  unbind(): void {
    this.release?.();
    this.release = undefined;
    this.cancel();
    this.state = undefined;
    this.refresh();
  }

  dispose(): void {
    this.unbind();
    this.subscribers.clear();
  }
}
