import { Subscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { retimeSelectionReason } from './commandAvailability.js';
import type { RetimeOptions, RetimeResult } from './keyframeRetiming.js';

export interface KeyframeRetimingSnapshot {
  readonly count: number;
  readonly scale: string;
  readonly anchor: RetimeOptions['anchor'];
  readonly reason: string;
  readonly preview: RetimeResult<ReadonlyAnimation> | null;
  readonly feedback: string;
}

/** React-only numerical preview, invalidated by authored/selection/session/options/anchor changes. */
export class KeyframeRetimingController {
  private state: AnimationEditorState | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly subscribers = new Subscribers({ label: 'Retiming panel listeners failed.' });
  private scale = '0.75';
  private anchor: RetimeOptions['anchor'] = 'earliest';
  private preview: RetimeResult<ReadonlyAnimation> | null = null;
  private feedback = '';
  private dependencies: readonly unknown[] = [];
  private snapshot: KeyframeRetimingSnapshot = this.buildSnapshot();

  readonly subscribe = this.subscribers.subscribe;
  readonly getSnapshot = (): KeyframeRetimingSnapshot => this.snapshot;

  bind(state: AnimationEditorState): void {
    this.unsubscribe?.();
    this.state = state;
    this.dependencies = [];
    this.unsubscribe = state.subscribe(() => this.refresh());
    this.refresh();
  }
  unbind(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.state = undefined;
    this.dependencies = [];
    this.hidePreview();
    this.feedback = '';
    this.refresh();
  }
  dispose(): void {
    this.unbind();
    this.subscribers.clear();
  }
  setScale(scale: string): void {
    this.scale = scale;
    this.refresh();
  }
  setAnchor(anchor: RetimeOptions['anchor']): void {
    this.anchor = anchor;
    this.refresh();
  }
  hidePreview(): void {
    if (!this.preview) return;
    this.preview = null;
    this.refresh();
  }
  private get options(): RetimeOptions {
    return { scale: Number(this.scale), anchor: this.anchor };
  }
  previewRetiming(): boolean {
    if (!this.state || this.snapshot.reason) return false;
    try {
      this.preview = this.state.keyframes.previewKeyframeRetiming(this.options);
      this.feedback = '';
    } catch (error) {
      this.preview = null;
      this.feedback = error instanceof Error ? error.message : String(error);
    }
    this.refresh();
    return this.preview !== null;
  }
  apply(): boolean {
    if (!this.state || this.snapshot.reason) return false;
    // Always rebuild from the current session/playhead; a numerical preview never authorizes stale data.
    if (!this.previewRetiming()) return false;
    if (this.preview!.animation === this.state.workingAnimation) {
      this.feedback = 'The selected key times are unchanged.';
      this.refresh();
      return false;
    }
    const count = this.snapshot.count;
    const success = this.state.keyframes.retimeSelectedKeyframes(this.options);
    this.preview = null;
    this.feedback = success
      ? `Retimed ${count} selected ${count === 1 ? 'key' : 'keys'}. One Undo restores the original timing.`
      : this.state.validationIssues.map((issue) => issue.message).join(' ');
    this.refresh();
    return success;
  }
  private buildSnapshot(): KeyframeRetimingSnapshot {
    const count = this.state?.ik.selectedIKKeyframe ? 1 : (this.state?.selectedKeys.length ?? 0);
    const scale = Number(this.scale);
    const selectionReason = this.state ? retimeSelectionReason(this.state) : 'Load a valid animation first.';
    const reason = selectionReason
      ? selectionReason
      : !Number.isFinite(scale) || scale <= 0
        ? 'Scale must be a finite number greater than zero.'
        : '';
    return { count, scale: this.scale, anchor: this.anchor, reason, preview: this.preview, feedback: this.feedback };
  }
  private refresh(): void {
    const dependencies = [
      this.state?.workingAnimation,
      this.state?.sessionRevision,
      this.state?.selectedKeys,
      this.state?.ik.selectedIKKeyframe,
      this.anchor === 'playhead' ? this.state?.currentTime : undefined,
      this.anchor,
      this.scale,
    ];
    if (dependencies.some((value, index) => value !== this.dependencies[index])) {
      this.dependencies = dependencies;
      this.preview = null;
      this.feedback = '';
    }
    const next = this.buildSnapshot();
    if ((Object.keys(next) as (keyof KeyframeRetimingSnapshot)[]).every((key) => next[key] === this.snapshot[key]))
      return;
    this.snapshot = Object.freeze(next);
    this.subscribers.notify();
  }
}
