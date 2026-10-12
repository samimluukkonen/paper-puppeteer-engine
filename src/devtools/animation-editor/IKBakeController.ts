import { compileClip, type AnimationClip, type CompiledClip } from '../../engine/AnimationClip.js';
import type { AnimationPose } from '../../engine/AnimationPose.js';
import { ANIMATION_FORMAT_VERSION, type ValidationIssue } from '../../engine/externalData.js';
import { type IKBakePlan } from '../../engine/ik/IKBakeGeneration.js';
import type { IKBakeMotionFidelity } from '../../engine/ik/IKBakeMotionFidelity.js';
import { getIKBakeRuntimeIssues } from '../../engine/ik/IKBakeSampling.js';
import { IsolatedIKSampler } from '../../engine/ik/IsolatedIKSampler.js';
import type { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import { dispatchListeners, throwNotificationErrors } from '../../engine/notifications.js';
import { type DeepReadonly, freezeData } from '../../engine/readonlyData.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { bakeRigSnapshot } from './ikBakePlanning.js';
import { startIKBakePlanning, type IKBakePlanningTask, type StartIKBakePlanning } from './ikBakeWorkerClient.js';

export interface IKBakeSnapshot {
  readonly constraints: readonly { readonly id: string; readonly bones: readonly string[]; readonly reason: string }[];
  readonly selectedIds: readonly string[];
  readonly fps: string;
  readonly plan: IKBakePlan | null;
  readonly motionFidelity: IKBakeMotionFidelity | null;
  readonly issues: readonly ValidationIssue[];
  readonly preview: boolean;
  readonly feedback: string;
  readonly pending: boolean;
}

/** Owns bake options/proposals only. Authored data, clock, selection and history stay in the editor. */
export class IKBakeController {
  private state: AnimationEditorState | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private selectedIds: readonly string[] = Object.freeze([]);
  private fps = '10';
  private preview = false;
  private feedback = '';
  private session: number | undefined;
  private dependencies: readonly unknown[] = [];
  private constraints: IKBakeSnapshot['constraints'] = Object.freeze([]);
  private plan: IKBakePlan | null = null;
  private motionFidelity: IKBakeMotionFidelity | null = null;
  private issues: readonly ValidationIssue[] = Object.freeze([]);
  private clip: CompiledClip | undefined;
  private sampler: IsolatedIKSampler | undefined;
  private previewTime: number | undefined;
  private panelOpen = false;
  private pending = false;
  private planningRevision = 0;
  private planningTimer: ReturnType<typeof setTimeout> | undefined;
  private planningTask: IKBakePlanningTask | undefined;
  private candidate: DeepReadonly<AnimationClip> | undefined;
  private candidateSource: AnimationEditorState['workingAnimation'] | undefined;
  private snapshot: IKBakeSnapshot = this.buildSnapshot();

  constructor(
    private readonly showPreview: (pose: AnimationPose | null) => void,
    private readonly runtimeConstraints: () => readonly TwoBoneIKConstraint[] = () => [],
    private readonly startPlanning: StartIKBakePlanning = startIKBakePlanning,
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): IKBakeSnapshot => this.snapshot;

  bind(state: AnimationEditorState): void {
    this.unbind();
    this.state = state;
    this.session = state.sessionRevision;
    this.unsubscribe = state.subscribe(() => this.refresh());
    this.refresh();
  }

  /** Closed panels never schedule full-clip work; opening prepares the latest selected options. */
  setPanelOpen(open: boolean): void {
    if (this.panelOpen === open) return;
    this.panelOpen = open;
    this.refresh();
  }

  setConstraint(id: string, selected: boolean): void {
    if (selected && this.constraints.find((entry) => entry.id === id)?.reason) return;
    this.selectedIds = Object.freeze(
      selected ? [...new Set([...this.selectedIds, id])] : this.selectedIds.filter((entry) => entry !== id),
    );
    this.feedback = '';
    this.clearPreview();
    this.refresh();
  }

  setFPS(text: string): void {
    this.fps = text;
    this.feedback = '';
    this.clearPreview();
    this.refresh();
  }

  togglePreview(): void {
    this.refresh();
    if (this.preview) {
      this.hidePreview();
      return;
    }
    if (!this.clip) return;
    this.state?.cancelTransformEdit();
    this.state?.cancelIKEdit();
    this.preview = true;
    this.state?.pause();
    this.previewTime = undefined;
    this.refresh();
  }

  hidePreview(): void {
    this.clearPreview();
    this.publish();
  }

  private clearPreview(): void {
    this.preview = false;
    this.previewTime = undefined;
    this.showPreview(null);
  }

  commit(): boolean {
    // Recheck source/session/options and mutable runtime ownership before installing the verified candidate.
    this.refresh();
    const state = this.state;
    const plan = this.plan;
    const candidate = this.candidate;
    if (!state || !plan?.success || !this.clip || !candidate || state.workingAnimation !== this.candidateSource)
      return false;
    const source = this.candidateSource;
    const revision = this.planningRevision;
    this.hidePreview();
    state.pause();
    this.refresh();
    if (this.state !== state || state.workingAnimation !== source || revision !== this.planningRevision) return false;
    // The worker already ran the engine's complete commit verification. Installing
    // its exact candidate avoids repeating that expensive solve on the UI thread.
    const success = state.replaceWorkingAnimation({ ...candidate, version: ANIMATION_FORMAT_VERSION });
    if (success) this.selectedIds = Object.freeze([]);
    this.feedback = success
      ? 'IK baked. Bone rotation tracks updated; Undo restores the original IK animation.'
      : state.validationIssues.map((issue) => issue.message).join(' ') || 'Bake could not be committed.';
    this.refresh();
    return success;
  }

  /** Called when scene-only fixed-target controls change without an authored edit. */
  refreshRuntime(): void {
    this.refresh();
  }

  private refresh(): void {
    const state = this.state;
    if (this.preview && (state?.hasTemporaryTransform || Object.keys(state?.ikTargetDraft ?? {}).length))
      this.clearPreview();
    if (state && this.session !== state.sessionRevision) {
      this.session = state.sessionRevision;
      this.selectedIds = Object.freeze([]);
      this.feedback = '';
      this.clearPreview();
    }
    const animation = state?.workingAnimation;
    const rig = state?.rig;
    const runtime = this.runtimeConstraints();
    // Solver status/targets change during playback; only authoring ownership/configuration invalidates a plan.
    const ownership = JSON.stringify(
      runtime.map((entry) => [
        entry.name,
        entry.targetOwnership,
        entry.rootBone,
        entry.middleBone,
        entry.endBone,
        entry.enabled,
        entry.priority,
        entry.mix,
        entry.hasMixOverride,
        entry.bendDirection,
        entry.endOffset,
      ]),
    );
    const dependencies = [animation, rig, this.selectedIds, this.fps, ownership, this.panelOpen];
    if (dependencies.some((value, index) => value !== this.dependencies[index])) {
      this.dependencies = dependencies;
      this.cancelPlanning();
      this.clearPreview();
      this.clip = undefined;
      this.sampler = undefined;
      this.plan = null;
      this.motionFidelity = null;
      this.candidate = undefined;
      this.candidateSource = undefined;
      this.constraints = Object.freeze(
        (rig?.ik ?? []).map((entry) =>
          Object.freeze({
            id: entry.name,
            bones: Object.freeze([entry.rootBone, entry.middleBone]),
            reason: animation?.disabledIKConstraints?.includes(entry.name)
              ? 'Already deactivated for this animation.'
              : entry.enabled === false
                ? 'Disabled in the rig.'
                : '',
          }),
        ),
      );
      this.issues = [];
      if (!animation || !rig)
        this.issues = state?.validationIssues.length
          ? state.validationIssues
          : [{ severity: 'error', message: 'Load a valid animation and rig first.' }];
      else if (!this.selectedIds.length)
        this.issues = [{ severity: 'error', message: 'Select one or more IK constraints to bake.' }];
      else if (!this.fps.trim())
        this.issues = [{ severity: 'error', message: 'Sampling FPS must be a finite positive number.' }];
      else if (this.constraints.some((entry) => this.selectedIds.includes(entry.id) && entry.reason))
        this.issues = [
          { severity: 'error', message: 'Selected IK is disabled. Undo the bake or choose an active constraint.' },
        ];
      else {
        this.issues = getIKBakeRuntimeIssues(rig, runtime);
        if (!this.issues.length && this.panelOpen) {
          this.pending = true;
          const revision = this.planningRevision;
          const ids = this.selectedIds;
          const fps = Number(this.fps);
          // Typing, constraint toggles and authored edits cancel the previous job
          // and settle before any new worker starts.
          this.planningTimer = setTimeout(() => {
            this.planningTimer = undefined;
            try {
              this.refresh();
              if (revision !== this.planningRevision) return;
              const task = this.startPlanning({ rig: bakeRigSnapshot(rig), animation, constraintIds: ids, fps });
              this.planningTask = task;
              void task.result
                .then(
                  (result) => {
                    if (revision !== this.planningRevision) return;
                    // Runtime ownership can change without a state notification.
                    // Refresh before accepting a reply to invalidate any stale job.
                    this.refresh();
                    if (revision !== this.planningRevision) return;
                    this.planningTask = undefined;
                    this.pending = false;
                    this.issues = freezeData([...result.issues]);
                    if (result.success) {
                      this.plan = freezeData(result.plan);
                      this.candidate = freezeData(result.animation);
                      this.candidateSource = animation;
                      this.motionFidelity = freezeData(result.motionFidelity);
                      this.clip = compileClip(this.candidate, rig);
                      this.sampler = new IsolatedIKSampler(rig);
                    }
                    this.publish();
                  },
                  (error: unknown) => this.planningFailed(revision, error),
                )
                .catch((error: unknown) => this.planningFailed(revision, error));
            } catch (error) {
              this.planningFailed(revision, error);
            }
          }, 200);
        }
      }
      this.issues = Object.freeze([...this.issues]);
    }
    if (this.preview && this.clip && this.sampler && state) {
      const time = state.currentTimeMilliseconds;
      if (this.previewTime !== time) {
        const sampled = this.sampler.sample(this.clip, time);
        this.showPreview(new Map([...sampled.pose].map(([id, pose]) => [id, { ...pose }])));
        this.previewTime = time;
      }
    }
    this.publish();
  }

  private cancelPlanning(): void {
    ++this.planningRevision;
    if (this.planningTimer !== undefined) clearTimeout(this.planningTimer);
    this.planningTimer = undefined;
    this.planningTask?.cancel();
    this.planningTask = undefined;
    this.pending = false;
  }

  private planningFailed(revision: number, error: unknown): void {
    if (revision !== this.planningRevision) return;
    this.planningTask = undefined;
    this.pending = false;
    this.plan = null;
    this.candidate = undefined;
    this.candidateSource = undefined;
    this.clip = undefined;
    this.sampler = undefined;
    this.motionFidelity = null;
    this.issues = Object.freeze([
      { severity: 'error', message: error instanceof Error ? error.message : String(error) },
    ]);
    this.publish();
  }

  private buildSnapshot(): IKBakeSnapshot {
    return Object.freeze({
      constraints: this.constraints,
      selectedIds: this.selectedIds,
      fps: this.fps,
      plan: this.clip ? this.plan : null,
      motionFidelity: this.motionFidelity,
      issues: this.issues,
      preview: this.preview,
      feedback: this.feedback,
      pending: this.pending,
    });
  }

  private publish(): void {
    const next = this.buildSnapshot();
    if ((Object.keys(next) as (keyof IKBakeSnapshot)[]).every((key) => next[key] === this.snapshot[key])) return;
    this.snapshot = next;
    throwNotificationErrors(
      dispatchListeners(this.listeners, (listener) => listener()),
      'IK bake listeners failed.',
    );
  }

  unbind(): void {
    this.cancelPlanning();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.state = undefined;
    this.session = undefined;
    this.dependencies = [];
    this.selectedIds = Object.freeze([]);
    this.constraints = Object.freeze([]);
    this.plan = null;
    this.motionFidelity = null;
    this.candidate = undefined;
    this.candidateSource = undefined;
    this.clip = undefined;
    this.sampler = undefined;
    this.issues = Object.freeze([]);
    this.feedback = '';
    this.hidePreview();
  }

  dispose(): void {
    this.listeners.clear();
    this.unbind();
  }
}
