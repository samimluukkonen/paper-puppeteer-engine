import type { Affine } from '../../engine/affineMath.js';
import { getIKBakeRuntimeIssues } from '../../engine/ik/IKBakeSampling.js';
import { IsolatedIKSampler } from '../../engine/ik/IsolatedIKSampler.js';
import type { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import type { Puppet } from '../../engine/Puppet.js';
import { transformProperties } from '../../engine/types.js';
import {
  contactGroundDistance,
  DEFAULT_CONTACT_TOLERANCE,
  evaluatedFootContacts,
} from '../shared/footContactGround.js';
import type { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { footContactConstraints, planFootContactAlignment, type FootContactAlignment } from './footContactAlignment.js';
import { getCompiledPreviewClip } from './previewClip.js';

/** View-only options, diagnostics and a disposable alignment proposal. No draft/key edits on preview. */
export class FootContactGroundController {
  private state: AnimationEditorState | undefined;
  private puppet: Puppet | undefined;
  private guide: GroundGuideWorkspace | undefined;
  private runtime: readonly TwoBoneIKConstraint[] = [];
  private releases: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private context: readonly unknown[] = [];
  private presentation: readonly unknown[] = [];
  private lastContactNotification = -Infinity;
  private pendingContactNotification = false;
  visible = false;
  markerId = '';
  constraintId = '';
  tolerance = DEFAULT_CONTACT_TOLERANCE;
  plan: FootContactAlignment | null = null;
  feedback = '';
  contacts: ReturnType<typeof evaluatedFootContacts> = [];

  /** Hidden proposals still need invalidation when their live context changes. */
  get needsSync(): boolean {
    return this.visible || !!this.plan;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): number => this.revision;
  private notify(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  bind(state: AnimationEditorState, guide: GroundGuideWorkspace): void {
    this.unbind();
    this.state = state;
    this.guide = guide;
    this.releases = [state.subscribe(() => this.refresh()), guide.subscribe(() => this.refresh())];
    this.refresh();
  }
  unbind(): void {
    for (const release of this.releases) release();
    this.releases = [];
    this.state = undefined;
    this.puppet = undefined;
    this.runtime = [];
    this.guide = undefined;
    this.context = [];
    this.presentation = [];
    this.lastContactNotification = -Infinity;
    this.pendingContactNotification = false;
    this.contacts = [];
    this.markerId = '';
    this.constraintId = '';
    this.plan = null;
    this.feedback = '';
    this.notify();
  }
  /** Called after the authoritative preview updates, also tracks facing/outer affine changes. */
  sync(puppet: Puppet, runtime?: readonly TwoBoneIKConstraint[], now = performance.now()): void {
    const changedPuppet = this.puppet !== puppet;
    if (runtime) this.runtime = runtime;
    else if (changedPuppet) this.runtime = (puppet.rig.ik ?? []).map((entry) => puppet.getIK(entry.name));
    this.puppet = puppet;
    if (!this.needsSync) {
      if (changedPuppet) this.refresh();
      return;
    }
    this.refresh();
    const contacts = this.visible ? evaluatedFootContacts(puppet, this.state?.rig) : [];
    if (JSON.stringify(contacts) !== JSON.stringify(this.contacts)) {
      this.contacts = contacts;
      this.pendingContactNotification = true;
    }
    // Flush the final sample even when playback stops before the next notification interval.
    // Canvas reads current contacts each frame; text diagnostics need at most ten updates/second.
    if (this.pendingContactNotification && now - this.lastContactNotification >= 100) {
      this.lastContactNotification = now;
      this.pendingContactNotification = false;
      this.notify();
    }
  }
  private matrix(): Affine | undefined {
    const matrix = this.puppet?.container.getWorldTransformMatrix();
    return matrix && { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, tx: matrix.tx, ty: matrix.ty };
  }
  private refresh(force = false): void {
    const state = this.state;
    const guide = this.guide?.getSnapshot();
    const active = force || this.needsSync;
    const matrix = active ? this.matrix() : undefined;
    const context = [
      state?.rig,
      state?.workingAnimation,
      active || this.feedback ? state?.currentTimeMilliseconds : undefined,
      state?.sessionRevision,
      state?.editorMode,
      state?.isPlaying,
      state?.selectedIKConstraintId,
      state?.ikTargetDraft,
      state?.boneTransformDraft,
      guide?.guide,
      guide?.dragging,
      this.puppet,
      matrix?.a,
      matrix?.b,
      matrix?.c,
      matrix?.d,
      matrix?.tx,
      matrix?.ty,
      state?.hasPendingAnimationEdits,
      active ? state?.getIKManipulationDisabledReason(this.constraintId) : undefined,
    ];
    if (active) for (const runtime of this.runtime) context.push(runtime, runtime.configurationRevision);
    if (context.length === this.context.length && context.every((value, index) => value === this.context[index]))
      return;
    this.context = context;
    const discardedProposal = !!this.plan || !!this.feedback;
    this.plan = null;
    this.feedback = '';
    if (!this.markers.some((entry) => entry.id === this.markerId)) this.markerId = '';
    if (!this.constraints.some((entry) => entry.name === this.constraintId)) this.constraintId = '';
    // Time and matrix changes invalidate proposals, but do not render hidden controls every frame.
    const presentation = [
      state?.rig,
      state?.workingAnimation,
      this.puppet,
      state?.editorMode,
      state?.isPlaying,
      active ? this.disabledReason : undefined,
      this.markerId,
      this.constraintId,
    ];
    if (
      discardedProposal ||
      presentation.length !== this.presentation.length ||
      presentation.some((value, index) => value !== this.presentation[index])
    ) {
      this.presentation = presentation;
      this.notify();
    }
  }
  get markers() {
    return this.state?.rig?.footContactMarkers ?? [];
  }
  get constraints() {
    const rig = this.state?.rig;
    const marker = this.markers.find((entry) => entry.id === this.markerId);
    return rig && marker ? footContactConstraints(rig, marker) : [];
  }
  selectMarker(id: string): void {
    this.markerId = this.markers.some((entry) => entry.id === id) ? id : '';
    this.constraintId = '';
    this.visible = true;
    this.cancel();
  }
  selectConstraint(id: string): void {
    this.constraintId = this.constraints.some((entry) => entry.name === id) ? id : '';
    this.cancel();
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.refresh();
    if (!visible) this.contacts = [];
    this.lastContactNotification = -Infinity;
    this.pendingContactNotification = false;
    this.notify();
  }
  setTolerance(value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.tolerance = value;
    this.cancel();
  }
  cancel(): void {
    this.plan = null;
    this.feedback = '';
    this.notify();
  }
  get disabledReason(): string {
    const state = this.state;
    if (!state?.animationAuthoringEnabled || !state.workingAnimation || !this.puppet)
      return 'Load an animation to align a contact.';
    if (!this.markerId) return 'Select a foot contact marker.';
    if (!this.constraints.length) return 'This marker requires manual posing or an existing foot IK setup.';
    if (!this.constraintId) return 'Confirm the applicable foot IK constraint.';
    if (!this.guide?.getSnapshot().guide.enabled) return 'Show the ground guide first.';
    if (this.guide.getSnapshot().dragging || state.ikTargetDrag) return 'Finish the current drag first.';
    if (state.hasPendingAnimationEdits) return 'Apply or cancel temporary edits before aligning.';
    const unavailable = state.getIKManipulationDisabledReason(this.constraintId);
    if (unavailable) return unavailable;
    if (getIKBakeRuntimeIssues(state.rig!, this.runtime).length)
      return 'Release runtime IK targets/providers and restore authored IK settings before aligning.';
    return '';
  }
  preview(): boolean {
    this.refresh(true);
    const reason = this.disabledReason;
    if (reason) {
      this.feedback = reason;
      this.notify();
      return false;
    }
    const state = this.state!;
    state.pause();
    state.endScrub();
    this.refresh(true);
    try {
      // Pose presets and external edits are not clip data. Refuse a mismatched preview context.
      if (!this.authoredPoseMatches())
        throw new Error('Restore the authored animation pose before aligning this contact.');
      this.plan = planFootContactAlignment(
        state.workingAnimation!,
        state.rig!,
        state.currentTimeMilliseconds,
        this.markerId,
        this.constraintId,
        this.matrix()!,
        this.guide!.getSnapshot().guide.y,
        this.tolerance,
      );
      const distance = contactGroundDistance(this.plan.contact, this.guide!.getSnapshot().guide.y, this.tolerance);
      this.feedback = `${this.plan.success ? 'Within tolerance' : 'Alignment limited'}: residual ${distance.distance.toFixed(3)} world units (${distance.relation}); IK ${this.plan.status}.`;
    } catch (error) {
      this.plan = null;
      this.feedback = error instanceof Error ? error.message : String(error);
    }
    this.notify();
    return !!this.plan;
  }
  apply(): boolean {
    this.refresh();
    const plan = this.plan;
    if (!plan?.success || this.disabledReason) return false;
    if (!this.authoredPoseMatches()) {
      this.cancel();
      this.feedback = 'The live pose changed. Restore the authored pose and preview alignment again.';
      this.notify();
      return false;
    }
    const state = this.state!;
    const id = this.constraintId;
    // Selection is view state; the normal authoring command installs X/Y together in existing history.
    this.cancel();
    if (!state.selectIKConstraint(id)) return false;
    return state.commitIKTarget(plan.target);
  }
  private authoredPoseMatches(): boolean {
    const state = this.state!;
    const baseline = new IsolatedIKSampler(state.rig!).sample(
      getCompiledPreviewClip(state.workingAnimation!, state.rig!),
      state.currentTimeMilliseconds,
    );
    return [...baseline.pose].every(([id, pose]) =>
      transformProperties.every(
        (property) => Math.abs(pose[property] - this.puppet!.getBone(id).pose[property]) <= 1e-6,
      ),
    );
  }
}
