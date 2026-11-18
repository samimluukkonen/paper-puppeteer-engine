import type { Affine, DeepReadonly } from '../../engine/data.js';
import type { AnimationPreviewPreferences } from '../shared/animationPreviewPreferences.js';
import { Subscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import {
  DEFAULT_MOTION_PREVIEW,
  evaluatePreviewDisplacement,
  validPreviewPositionKeys,
  type MotionPreviewSettings,
  type PreviewPositionKey,
} from './motionPreview.js';
import { previewTrajectoryToRootMotion } from './previewTrajectoryCopy.js';
import { rootMotionMatrix } from './rootMotionCoordinates.js';

/** Owns clip preview preferences and detached copy proposals; explicit commits delegate to session history. */
export class MotionPreviewController {
  private state: AnimationEditorState | undefined;
  private release: (() => void) | undefined;
  private readonly loops = new Map<string, boolean>();
  private observedLoop = false;
  private synchronizing = false;
  private placement: (() => Affine) | undefined;
  private copy:
    | { placement: Affine; previousMode: AnimationEditorState['rootMotion']['worldDisplacementMode'] }
    | undefined;
  private readonly clips = new Map<string, MotionPreviewSettings>();
  private readonly subscribers = new Subscribers({ label: 'Motion preview subscribers failed.' });
  private snapshot: Readonly<{
    clipId: string | null;
    duration: number;
    ready: boolean;
    settings: MotionPreviewSettings;
    message: string;
    copying: boolean;
  }> = Object.freeze({
    clipId: null as string | null,
    duration: 0,
    ready: false,
    settings: DEFAULT_MOTION_PREVIEW,
    message: '',
    copying: false,
  });
  readonly subscribe = this.subscribers.subscribe;
  readonly getSnapshot = () => this.snapshot;
  private publish(patch: Partial<typeof this.snapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    this.subscribers.notify();
  }
  bind(state: AnimationEditorState): void {
    this.unbind();
    this.state = state;
    const sync = () => {
      if (this.synchronizing) return;
      if (this.copy && !state.trajectoryCopyActive) {
        this.copy = undefined;
        this.publish({ copying: false });
      }
      const clipId = state.selectedAnimationId;
      const duration = state.workingAnimation?.duration ?? 0;
      const ready = !!clipId && state.animationAuthoringEnabled;
      if (clipId === this.snapshot.clipId && duration === this.snapshot.duration && ready === this.snapshot.ready) {
        const settings = this.snapshot.settings;
        if (
          clipId &&
          (state.rootMotion.worldDisplacementMode !==
            (settings.displacementMode ?? (settings.enabled ? 'preview' : 'authored')) ||
            state.rootMotion.rootLoopMode !== (settings.rootLoopMode ?? 'reset'))
        ) {
          const next = Object.freeze({
            ...settings,
            displacementMode: state.rootMotion.worldDisplacementMode,
            rootLoopMode: state.rootMotion.rootLoopMode,
            enabled: state.rootMotion.worldDisplacementMode === 'preview',
          });
          this.clips.set(clipId, next);
          this.publish({ settings: next });
        }
        if (clipId && state.previewLoop !== this.observedLoop) {
          this.observedLoop = state.previewLoop;
          this.loops.set(clipId, state.previewLoop);
          this.publish({});
        }
        return;
      }
      const loop = clipId !== this.snapshot.clipId ? (clipId && this.loops.get(clipId)) || false : state.previewLoop;
      this.observedLoop = loop;
      const settings = (clipId && this.clips.get(clipId)) || DEFAULT_MOTION_PREVIEW;
      this.applyView(settings);
      this.publish({
        clipId,
        duration,
        ready,
        settings,
        message: '',
      });
      if (loop !== state.previewLoop) state.setPreviewLoop(loop);
    };
    this.release = state.subscribe(sync);
    sync();
  }
  private applyView(settings: MotionPreviewSettings): void {
    this.synchronizing = true;
    try {
      this.state?.rootMotion.setWorldDisplacementView(
        settings.displacementMode ?? (settings.enabled ? 'preview' : 'authored'),
        settings.rootLoopMode ?? 'reset',
      );
    } finally {
      this.synchronizing = false;
    }
  }
  attachPlacement(provider: () => Affine): () => void {
    this.placement = provider;
    return () => {
      if (this.placement === provider) {
        this.cancelCopy();
        this.placement = undefined;
      }
    };
  }
  previewCopy(): boolean {
    this.cancelCopy();
    const state = this.state;
    const placement = this.placement?.();
    if (!state || !placement || !state.workingAnimation) return false;
    try {
      const settings = this.snapshot.settings;
      const root = previewTrajectoryToRootMotion(settings, state.workingAnimation.duration, placement);
      const previousMode = state.rootMotion.worldDisplacementMode;
      if (!state.previewTrajectoryCopy(root)) {
        this.publish({ message: 'Commit or cancel temporary animation edits before previewing a trajectory copy.' });
        return false;
      }
      this.copy = { placement: rootMotionMatrix(placement, { x: 0, y: 0 }), previousMode };
      this.publish({
        copying: true,
        message:
          'Previewing copied root motion. Scrub or play before applying. Applying replaces all existing root-motion keys in one Undo operation.',
      });
      return true;
    } catch (error) {
      this.publish({ message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
  cancelCopy(): void {
    const copy = this.copy;
    this.copy = undefined;
    if (!copy) return;
    const owned = this.state?.trajectoryCopyActive;
    this.state?.cancelTrajectoryCopy();
    if (owned) this.state?.rootMotion.setWorldDisplacementView(copy.previousMode);
    this.publish({ copying: false, message: '' });
  }
  commitCopy(): boolean {
    const copy = this.copy;
    const placement = this.placement?.();
    if (!copy || !placement || !this.state?.trajectoryCopyActive) return false;
    if (['a', 'b', 'c', 'd'].some((key) => placement[key as keyof Affine] !== copy.placement[key as keyof Affine])) {
      this.cancelCopy();
      this.publish({ message: 'Character facing, rotation or scale changed. Preview the copy again before applying.' });
      return false;
    }
    // The proposal is validated and committed through the document's single history transaction.
    const applied = this.state.commitTrajectoryCopy();
    if (applied) {
      this.copy = undefined;
      this.publish({
        copying: false,
        message:
          'Preview trajectory copied to root motion. Original preview points are retained. Undo restores the previous root keys.',
      });
    }
    return applied;
  }
  capturePreferences(): DeepReadonly<AnimationPreviewPreferences['animations']> {
    const ids = new Set([...this.clips.keys(), ...this.loops.keys()]);
    return Object.fromEntries(
      [...ids].map((id) => [
        id,
        {
          motion: this.clips.get(id) ?? DEFAULT_MOTION_PREVIEW,
          loop: this.loops.get(id) ?? false,
        },
      ]),
    );
  }
  restorePreferences(preferences: DeepReadonly<AnimationPreviewPreferences['animations']>): void {
    this.cancelCopy();
    this.clips.clear();
    this.loops.clear();
    for (const [id, preference] of Object.entries(preferences)) {
      this.clips.set(id, preference.motion);
      this.loops.set(id, preference.loop);
    }
    const id = this.snapshot.clipId;
    this.observedLoop = (id && this.loops.get(id)) || false;
    const settings = (id && this.clips.get(id)) || DEFAULT_MOTION_PREVIEW;
    this.applyView(settings);
    this.publish({ settings });
    if (this.state && this.state.previewLoop !== this.observedLoop) this.state.setPreviewLoop(this.observedLoop);
  }
  update(patch: Partial<MotionPreviewSettings>): boolean {
    this.cancelCopy();
    const { clipId, ready, settings } = this.snapshot;
    if (!clipId || !ready) return false;
    const displacementMode =
      patch.displacementMode ??
      (patch.enabled === undefined
        ? (settings.displacementMode ?? (settings.enabled ? 'preview' : 'authored'))
        : patch.enabled
          ? 'preview'
          : 'authored');
    const next = { ...settings, ...patch, displacementMode, enabled: displacementMode === 'preview' };
    const keys = [...next.positionKeys].sort((a, b) => a.time - b.time);
    if (keys.length > 10000) {
      this.publish({ message: 'Use at most 10,000 preview position points per animation.' });
      return false;
    }
    if (!validPreviewPositionKeys(keys) || !['linear', 'stepped'].includes(next.interpolation)) {
      this.publish({ message: 'Use finite X/Y values and unique, nonnegative point times.' });
      return false;
    }
    const frozen = Object.freeze({
      ...next,
      positionKeys: Object.freeze(keys.map((key) => Object.freeze({ ...key }))),
    });
    this.clips.set(clipId, frozen);
    this.applyView(frozen);
    this.publish({ settings: frozen, message: '' });
    return true;
  }
  addPoint(): void {
    const { settings, duration } = this.snapshot;
    const keys = settings.positionKeys;
    let time = this.state?.currentTimeMilliseconds ?? 0;
    if (keys.some((key) => key.time === time)) {
      const boundaries = [...new Set([0, duration, ...keys.map((key) => key.time)])].sort((a, b) => a - b);
      let gap = 0;
      for (let index = 1; index < boundaries.length; index++) {
        const start = boundaries[index - 1]!;
        const end = boundaries[index]!;
        if (end - start > gap) {
          gap = end - start;
          time = (start + end) / 2;
        }
      }
      if (!gap) time += 100;
    }
    const offset = evaluatePreviewDisplacement({ ...settings, enabled: true }, time);
    this.update({ positionKeys: [...keys, { time, offsetX: offset.x, offsetY: offset.y }] });
  }
  editPoint(index: number, key: PreviewPositionKey): boolean {
    return this.update({
      positionKeys: this.snapshot.settings.positionKeys.map((old, i) => (i === index ? key : old)),
    });
  }
  removePoint(index: number): void {
    this.update({ positionKeys: this.snapshot.settings.positionKeys.filter((_, i) => i !== index) });
  }
  reset(): void {
    this.update(DEFAULT_MOTION_PREVIEW);
  }
  unbind(): void {
    this.cancelCopy();
    this.release?.();
    this.release = undefined;
    this.state = undefined;
    this.clips.clear();
    this.loops.clear();
    this.observedLoop = false;
    this.publish({
      clipId: null,
      duration: 0,
      ready: false,
      settings: DEFAULT_MOTION_PREVIEW,
      message: '',
      copying: false,
    });
  }
  dispose(): void {
    this.unbind();
    this.subscribers.clear();
  }
}
