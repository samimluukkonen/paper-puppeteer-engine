import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { AnimationPreviewPreferences } from '../shared/animationPreviewPreferences.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import {
  DEFAULT_MOTION_PREVIEW,
  evaluatePreviewDisplacement,
  validPreviewPositionKeys,
  type MotionPreviewSettings,
  type PreviewPositionKey,
} from './motionPreview.js';

/** Clip-specific editor preferences; never writes animation documents or authored history. */
export class MotionPreviewController {
  private state: AnimationEditorState | undefined;
  private release: (() => void) | undefined;
  private readonly loops = new Map<string, boolean>();
  private observedLoop = false;
  private readonly clips = new Map<string, MotionPreviewSettings>();
  private readonly listeners = new Set<() => void>();
  private snapshot: Readonly<{
    clipId: string | null;
    duration: number;
    ready: boolean;
    settings: MotionPreviewSettings;
    message: string;
  }> = Object.freeze({
    clipId: null as string | null,
    duration: 0,
    ready: false,
    settings: DEFAULT_MOTION_PREVIEW,
    message: '',
  });
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.snapshot;
  private publish(patch: Partial<typeof this.snapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of Array.from(this.listeners)) listener();
  }
  bind(state: AnimationEditorState): void {
    this.unbind();
    this.state = state;
    const sync = () => {
      const clipId = state.selectedAnimationId;
      const duration = state.workingAnimation?.duration ?? 0;
      const ready = !!clipId && state.animationAuthoringEnabled;
      if (clipId === this.snapshot.clipId && duration === this.snapshot.duration && ready === this.snapshot.ready) {
        if (clipId && state.previewLoop !== this.observedLoop) {
          this.observedLoop = state.previewLoop;
          this.loops.set(clipId, state.previewLoop);
          this.publish({});
        }
        return;
      }
      const loop = clipId !== this.snapshot.clipId ? (clipId && this.loops.get(clipId)) || false : state.previewLoop;
      this.observedLoop = loop;
      this.publish({
        clipId,
        duration,
        ready,
        settings: (clipId && this.clips.get(clipId)) || DEFAULT_MOTION_PREVIEW,
        message: '',
      });
      if (loop !== state.previewLoop) state.setPreviewLoop(loop);
    };
    this.release = state.subscribe(sync);
    sync();
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
    this.clips.clear();
    this.loops.clear();
    for (const [id, preference] of Object.entries(preferences)) {
      this.clips.set(id, preference.motion);
      this.loops.set(id, preference.loop);
    }
    const id = this.snapshot.clipId;
    this.observedLoop = (id && this.loops.get(id)) || false;
    this.publish({ settings: (id && this.clips.get(id)) || DEFAULT_MOTION_PREVIEW });
    if (this.state && this.state.previewLoop !== this.observedLoop) this.state.setPreviewLoop(this.observedLoop);
  }
  update(patch: Partial<MotionPreviewSettings>): boolean {
    const { clipId, ready, settings } = this.snapshot;
    if (!clipId || !ready) return false;
    const next = { ...settings, ...patch };
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
    this.release?.();
    this.release = undefined;
    this.state = undefined;
    this.clips.clear();
    this.loops.clear();
    this.observedLoop = false;
    this.publish({ clipId: null, duration: 0, ready: false, settings: DEFAULT_MOTION_PREVIEW, message: '' });
  }
  dispose(): void {
    this.unbind();
    this.listeners.clear();
  }
}
