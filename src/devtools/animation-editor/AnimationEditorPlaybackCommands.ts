import type { AnimationPlaybackMode } from '../../engine/data.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
import { DEFAULT_KEYFRAME_FPS } from './timeline.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

export const AUTHORED_FPS_MIN = 1;
export const AUTHORED_FPS_MAX = 240;
export const DEFAULT_AUTHORED_FPS = DEFAULT_KEYFRAME_FPS;

/** Authored playback metadata uses the same validated document/history boundary as key and event edits. */
export class AnimationEditorPlaybackCommands {
  constructor(
    private readonly document: AnimationEditorDocument,
    private readonly session: AnimationEditActions,
  ) {}

  setAuthoredFPS(fps: number): boolean {
    if (this.document.workingAnimation?.playback?.mode !== 'stepped') return false;
    if (!Number.isFinite(fps) || fps < AUTHORED_FPS_MIN || fps > AUTHORED_FPS_MAX) {
      this.document.reportIssues([
        {
          severity: 'error',
          path: 'playback.fps',
          message: `Animation FPS must be a finite number from ${AUTHORED_FPS_MIN} to ${AUTHORED_FPS_MAX}.`,
        },
      ]);
      this.session.notify();
      return false;
    }
    return this.setAuthoredPlayback({ mode: 'stepped', fps });
  }

  setAuthoredPlaybackMode(mode: AnimationPlaybackMode['mode']): boolean {
    const animation = this.document.workingAnimation;
    if (!animation || (mode !== 'smooth' && mode !== 'stepped')) return false;
    if (mode === (animation.playback?.mode ?? 'smooth')) return true;
    return this.setAuthoredPlayback(mode === 'smooth' ? { mode } : { mode, fps: DEFAULT_AUTHORED_FPS });
  }

  private setAuthoredPlayback(playback: AnimationPlaybackMode): boolean {
    const source = this.document.workingAnimation;
    const rig = this.document.rig;
    if (!source || !rig) return false;
    let next: ReadonlyAnimation;
    try {
      getValidatedEditorAnimation(source, rig);
      next = validateEditedAnimation({ ...source, playback }, source, rig);
    } catch (error) {
      this.document.reportError(error);
      this.session.notify();
      return false;
    }
    return this.session.install(next);
  }
}
