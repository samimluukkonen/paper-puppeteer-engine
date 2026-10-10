import { z } from 'zod';
import type { AnimationPose } from '../../engine/AnimationPose.js';
import { AnimationValidationError } from '../../engine/externalData.js';
import { dispatchListeners, throwNotificationErrors } from '../../engine/notifications.js';
import {
  type BoneSymmetryPair,
  type BoneSymmetryMapping,
  createBoneSymmetryMapping,
  inferBoneSymmetryPairs,
  validateBoneSymmetryMapping,
} from '../shared/boneSymmetry.js';
import { draftSource } from '../shared/draftSource.js';
import { freezeData } from '../shared/editorData.js';
import type { MirrorDirection } from '../shared/poseMirroring.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { getEvaluatedAnimationPose } from './animationValues.js';
import { mirrorCurrentPoseToKeys, mirrorSelectedKeyframes } from './keyframeMirroring.js';
import { findBonePropertyKeyframe } from './keyframeQueries.js';
import { toMilliseconds } from './timeUnits.js';

const preferencesSchema = z.strictObject({
  version: z.literal(1),
  rig: z.string(),
  pairs: z.array(z.strictObject({ leftBoneId: z.string().min(1), rightBoneId: z.string().min(1) })),
});

export interface MirrorToolsSnapshot {
  readonly ready: boolean;
  readonly direction: MirrorDirection;
  readonly pairs: readonly BoneSymmetryPair[];
  readonly boneIds: readonly string[];
  readonly unpaired: readonly string[];
  readonly mappingErrors: readonly string[];
  readonly poseReason: string;
  readonly keysReason: string;
  readonly scope: string;
  readonly preview: boolean;
  readonly feedback: string;
  readonly persistence: string;
}

function errorMessage(error: unknown): string {
  return error instanceof AnimationValidationError
    ? error.issues.map((issue) => `${issue.path ? `${issue.path}: ` : ''}${issue.message}`).join(' ')
    : error instanceof Error
      ? error.message
      : String(error);
}

/** React preferences and cached command readiness; selection and time remain exclusively in editor state. */
export class MirrorToolsController {
  private state: AnimationEditorState | undefined;
  private installedMapping: BoneSymmetryMapping | null | undefined;
  private installing = false;
  private unsubscribe: (() => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private direction: MirrorDirection = 'left-to-right';
  private pairs: readonly BoneSymmetryPair[] = [];
  private preview = false;
  private feedback = '';
  private persistence = '';
  private storageKey = '';
  private rigSource = '';
  private snapshot: MirrorToolsSnapshot;
  private pose: AnimationPose | null = null;
  private poseDependencies: readonly unknown[] = [];
  private keysDependencies: readonly unknown[] = [];
  private poseReason = '';
  private keysReason = '';

  constructor(
    private readonly showPreview: (pose: AnimationPose | null) => void,
    private readonly storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => window.localStorage,
  ) {
    this.snapshot = this.buildSnapshot();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): MirrorToolsSnapshot => this.snapshot;

  bind(state: AnimationEditorState, identity: string): void {
    this.unsubscribe?.();
    this.showPreview(null);
    this.state = state;
    this.installedMapping = state.symmetryMapping;
    this.preview = false;
    this.feedback = '';
    this.persistence = '';
    this.poseDependencies = [];
    this.keysDependencies = [];
    this.storageKey = `paper-puppeteer:mirror-pairs:${identity}`;
    this.rigSource = draftSource(state.rig?.bones ?? []);
    let pairs = state.rig ? inferBoneSymmetryPairs(state.rig).pairs : [];
    if (state.rig) {
      try {
        const text = this.storage().getItem(this.storageKey);
        if (text !== null) {
          const parsed = preferencesSchema.safeParse(JSON.parse(text));
          if (!parsed.success || parsed.data.rig !== this.rigSource)
            this.persistence = 'Saved pairs do not match this rig. Review the inferred pairs and save a new mapping.';
          else if (validateBoneSymmetryMapping(state.rig, { pairs: parsed.data.pairs }).length)
            this.persistence = 'Saved pairs are invalid for this rig. Review the inferred pairs.';
          else pairs = parsed.data.pairs;
        }
      } catch {
        this.persistence = 'Browser pair storage is unavailable. Pair changes will last for this session.';
      }
    }
    this.pairs = freezeData(pairs);
    this.installPairs(false);
    this.unsubscribe = state.subscribe(() => {
      if (!this.installing && state.symmetryMapping !== this.installedMapping) {
        this.pairs = state.symmetryMapping?.pairs ?? [];
        this.installedMapping = state.symmetryMapping;
        this.feedback = '';
      }
      this.refresh();
    });
    this.refresh();
  }

  setDirection(direction: MirrorDirection): void {
    if (!['left-to-right', 'right-to-left', 'swap'].includes(direction)) return;
    this.direction = direction;
    this.feedback = '';
    this.refresh();
  }

  setPairs(pairs: readonly BoneSymmetryPair[]): void {
    this.pairs = freezeData(pairs);
    this.feedback = '';
    this.installPairs(true);
    this.refresh();
  }

  inferPairs(): void {
    if (!this.state?.rig) return;
    const inferred = inferBoneSymmetryPairs(this.state.rig);
    this.setPairs(inferred.pairs);
    this.feedback =
      inferred.issues.map((issue) => issue.message).join(' ') ||
      'Inferred pairs restored. Review left and right assignments.';
    this.refresh();
  }

  private installPairs(save: boolean): void {
    const state = this.state;
    if (!state?.rig) return;
    const result = createBoneSymmetryMapping(state.rig, { manualPairs: this.pairs });
    // Invalid drafts stay visible, and block every mirror action instead of falling back to older pairs.
    if (!result.success || result.issues.length) return;
    this.installing = true;
    try {
      state.setSymmetryMapping(result.mapping);
    } finally {
      this.installedMapping = state.symmetryMapping;
      this.installing = false;
    }
    if (save) {
      try {
        this.storage().setItem(this.storageKey, JSON.stringify({ version: 1, rig: this.rigSource, pairs: this.pairs }));
        this.persistence = 'Pairs saved in this browser for this rig. They are excluded from animation and rig JSON.';
      } catch {
        this.persistence = 'Could not save pairs in this browser. Pair changes will last for this session.';
      }
    }
  }

  togglePreview(): void {
    if (!this.preview && this.snapshot.poseReason) return;
    this.preview = !this.preview;
    this.refresh();
  }

  commitPose(): boolean {
    const state = this.state;
    if (!state || this.snapshot.poseReason) return false;
    return this.commit(() => state.mirrorCurrentPoseToKeys(this.direction), 'Current pose mirrored.');
  }

  commitKeys(): boolean {
    const state = this.state;
    if (!state || this.snapshot.keysReason) return false;
    return this.commit(() => state.mirrorSelectedKeyframes(this.direction), 'Selected keys mirrored.');
  }

  private commit(command: () => boolean, message: string): boolean {
    this.preview = false;
    this.showPreview(null);
    const success = command();
    this.feedback = success
      ? message
      : this.state?.validationIssues.map((issue) => issue.message).join(' ') ||
        'The mirrored values already match the destination.';
    this.refresh();
    return success;
  }

  private buildSnapshot(): MirrorToolsSnapshot {
    const state = this.state;
    const boneIds = state?.rig?.bones.map((bone) => bone.id) ?? [];
    const assigned = new Set(this.pairs.flatMap((pair) => [pair.leftBoneId, pair.rightBoneId]));
    const mappingErrors = state?.rig
      ? validateBoneSymmetryMapping(state.rig, { pairs: this.pairs }).map(
          (issue) => `${issue.path ? `${issue.path}: ` : ''}${issue.message}`,
        )
      : ['Load a rig to configure bone pairs.'];
    const reason =
      mappingErrors.join(' ') ||
      (!this.pairs.length
        ? 'No paired bones. Configure at least one bone pair.'
        : !state?.workingAnimation
          ? state?.validationIssues.map((issue) => issue.message).join(' ') || 'Load a valid animation first.'
          : '');
    const mapping = state?.symmetryMapping;
    const poseDependencies = [
      state?.workingAnimation,
      state?.currentTime,
      state?.selectedBoneId,
      mapping,
      this.pairs,
      this.direction,
    ];
    if (poseDependencies.some((value, index) => value !== this.poseDependencies[index])) {
      this.poseDependencies = poseDependencies;
      this.pose = null;
      this.poseReason = reason;
      if (!reason && state?.workingAnimation && state.rig && mapping) {
        try {
          const result = mirrorCurrentPoseToKeys(
            state.workingAnimation,
            state.rig,
            mapping,
            toMilliseconds(state.currentTime),
            this.direction,
            state.selectedBoneId ? { boneIds: [state.selectedBoneId] } : {},
          );
          if (!result.keys.length) this.poseReason = 'The source has no authored transform tracks to mirror.';
          else {
            this.pose = getEvaluatedAnimationPose(state.workingAnimation, state.rig, toMilliseconds(state.currentTime));
            // Project the proposed authored values directly. Resampling the proposal would quantize
            // a stepped playhead before its newly inserted key and show an older destination value.
            for (const key of result.keys) {
              this.pose.get(key.boneId)![key.property] = findBonePropertyKeyframe(
                result.animation,
                key.boneId,
                key.property,
                key.timeMs,
              )!.value;
            }
          }
        } catch (error) {
          this.poseReason = errorMessage(error);
        }
      }
    }
    const keysDependencies = [state?.workingAnimation, state?.selectedKeys, mapping, this.pairs, this.direction];
    if (keysDependencies.some((value, index) => value !== this.keysDependencies[index])) {
      this.keysDependencies = keysDependencies;
      this.keysReason =
        reason ||
        (!state?.selectedKeys.length ? 'Select source transform keys in the timeline. Events cannot be mirrored.' : '');
      if (!this.keysReason && state?.workingAnimation && state.rig && mapping) {
        try {
          mirrorSelectedKeyframes(
            state.workingAnimation,
            state.rig,
            mapping,
            state.selectedKeys.map((key) => ({
              boneId: key.boneId,
              property: key.property,
              timeMs: toMilliseconds(key.time),
            })),
            this.direction,
          );
        } catch (error) {
          this.keysReason = errorMessage(error);
        }
      }
    }
    if (this.poseReason) this.preview = false;
    return Object.freeze({
      ready: !!state?.rig,
      direction: this.direction,
      pairs: this.pairs,
      boneIds,
      unpaired: boneIds.filter((id) => !assigned.has(id)),
      mappingErrors,
      poseReason: this.poseReason || reason,
      keysReason: this.keysReason || reason,
      scope: state?.selectedBoneId
        ? `Current pose source: ${state.selectedBoneId}.`
        : 'Current pose source: all mapped bones on the source side.',
      preview: this.preview,
      feedback: this.feedback,
      persistence: this.persistence,
    });
  }

  private refresh(): void {
    const next = this.buildSnapshot();
    this.showPreview(next.preview ? this.pose : null);
    // Clock notifications with unchanged readiness never cause React to render again.
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    throwNotificationErrors(
      dispatchListeners(this.listeners, (listener) => listener()),
      'Mirror tools listeners failed.',
    );
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.showPreview(null);
    this.listeners.clear();
    this.state = undefined;
    this.pose = null;
  }
}
