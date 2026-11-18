import type { IKAnimationProperty, TransformProperty } from '../../engine/data.js';
import { Subscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import {
  DEFAULT_MOTION_OPTIONS,
  diagnoseMotion,
  previewMotionCleanup,
  type CleanupPreview,
  type MotionDiagnosticOptions,
  type MotionFinding,
  type MotionReport,
} from './motionDiagnostics.js';

/** Caches manual analysis by authored snapshot/session. Clock notifications never run analysis. */
export class MotionDiagnosticsController {
  private state: AnimationEditorState | undefined;
  private release: (() => void) | undefined;
  private readonly subscribers = new Subscribers({ label: 'Motion diagnostics listeners failed.' });
  private dependencies: readonly unknown[] = [];
  private options = { ...DEFAULT_MOTION_OPTIONS };
  private report: MotionReport | null = null;
  private preview: CleanupPreview<ReadonlyAnimation> | null = null;
  private selected = new Set<number>();
  private feedback = '';
  private timeMs = 0;
  private after = false;
  private snapshot = this.buildSnapshot();
  readonly subscribe = this.subscribers.subscribe;
  readonly getSnapshot = () => this.snapshot;
  bind(state: AnimationEditorState): void {
    this.unbind();
    this.state = state;
    this.release = state.subscribe(() => this.refresh());
    this.refresh();
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
  private get reason(): string {
    if (!this.state?.rig || !this.state.workingAnimation) return 'Select an animation first.';
    if (!this.state.animationAuthoringEnabled) return 'Switch to Animation mode.';
    if (this.state.hasPendingAnimationEdits) return 'Commit or cancel temporary edits first.';
    return '';
  }
  private buildSnapshot() {
    return {
      name: this.state?.workingAnimation?.name ?? '',
      duration: this.state?.workingAnimation?.duration ?? 0,
      reason: this.reason,
      options: this.options,
      report: this.report,
      preview: this.preview,
      selected: this.selected,
      feedback: this.feedback,
      timeMs: this.timeMs,
      after: this.after,
    };
  }
  private publish(): void {
    this.snapshot = this.buildSnapshot();
    this.subscribers.notify();
  }
  private refresh(): void {
    const dependencies = [this.state?.workingAnimation, this.state?.rig, this.state?.sessionRevision, this.reason];
    if (dependencies.every((value, index) => value === this.dependencies[index])) {
      if (this.preview && !this.state?.cleanupPreviewActive) {
        this.preview = null;
        this.publish();
      }
      return;
    }
    this.dependencies = dependencies;
    this.report = null;
    this.selected = new Set();
    this.feedback = '';
    this.cancel();
    this.publish();
  }
  setOption(key: keyof MotionDiagnosticOptions, value: number): void {
    this.options = { ...this.options, [key]: value };
    this.report = null;
    this.selected = new Set();
    this.cancel();
    this.publish();
  }
  run(): boolean {
    if (this.reason || !this.state?.rig || !this.state.workingAnimation) return false;
    this.cancel();
    try {
      this.report = diagnoseMotion(this.state.workingAnimation, this.state.rig, this.options);
      this.selected = new Set(this.report.candidates.map((_, index) => index));
      this.feedback = 'Analysis complete. Findings are possible issues; review intentional fast motion.';
    } catch (error) {
      this.report = null;
      this.feedback = String(error);
    }
    this.publish();
    return !!this.report;
  }
  toggle(index: number): void {
    this.cancel();
    this.selected = new Set(this.selected);
    if (this.selected.has(index)) this.selected.delete(index);
    else this.selected.add(index);
    this.publish();
  }
  inspect(finding: MotionFinding): void {
    const state = this.state;
    if (!state || this.reason) return;
    this.cancel();
    state.setTimelineFilters({ search: '', mode: 'all', showIK: true });
    if (finding.kind === 'bone') {
      state.setTimelineBoneExpanded(finding.id, true);
      state.selectKeyframe({
        boneId: finding.id,
        property: finding.property as TransformProperty,
        time: finding.timeMs / 1000,
      });
    } else {
      state.ik.setTimelineIKExpanded(finding.id, true);
      state.ik.selectIKKeyframe({
        kind: 'ik',
        constraintId: finding.id,
        property: finding.property as IKAnimationProperty,
        time: finding.timeMs / 1000,
      });
    }
  }
  private get targets() {
    return this.report?.candidates.filter((_, index) => this.selected.has(index)) ?? [];
  }
  previewCleanup(): boolean {
    if (this.reason || !this.state?.rig || !this.state.workingAnimation || !this.targets.length) return false;
    try {
      this.preview = previewMotionCleanup(this.state.workingAnimation, this.state.rig, this.targets, this.options);
      this.timeMs = this.targets[0]!.timeMs;
      this.after = true;
      this.compare(this.timeMs, true);
      this.feedback = '';
    } catch (error) {
      this.cancel();
      this.feedback = String(error);
    }
    this.publish();
    return !!this.preview;
  }
  compare(timeMs: number, after: boolean): void {
    if (!this.preview || !this.state?.workingAnimation || this.reason) return;
    this.timeMs = timeMs;
    this.after = after;
    this.state.previewCleanup(after ? this.preview.animation : this.state.workingAnimation, timeMs);
    this.publish();
  }
  cancel(): void {
    this.preview = null;
    this.state?.cancelCleanupPreview();
    this.publish();
  }
  apply(): boolean {
    if (!this.preview || this.reason || !this.state) return false;
    try {
      const changed = this.state.applyMotionCleanup(this.targets, this.options);
      if (changed) {
        this.run();
        this.feedback = 'Cleanup applied and revalidated. One Undo restores all removed keys.';
      }
      this.publish();
      return changed;
    } catch (error) {
      this.feedback = String(error);
      this.publish();
      return false;
    }
  }
}
