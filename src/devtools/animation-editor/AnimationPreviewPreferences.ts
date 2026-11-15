import { equalJsonData, freezeData, type DeepReadonly } from '../../engine/core.js';
import {
  animationPreviewPreferencesSchema,
  type AnimationPreviewPreferences,
} from '../shared/animationPreviewPreferences.js';
import type { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import type { EnvironmentPreviewController } from './EnvironmentPreviewController.js';
import type { MotionPreviewController } from './MotionPreviewController.js';

/** Bridges existing preview owners to project metadata/draft capture, without observing the frame clock. */
export class AnimationPreviewPreferencesBinding {
  private readonly releases: (() => void)[];
  private current: DeepReadonly<AnimationPreviewPreferences>;
  private readonly baseline: DeepReadonly<AnimationPreviewPreferences>;
  private imageRevision: number;
  constructor(
    private readonly environment: EnvironmentPreviewController,
    private readonly motion: MotionPreviewController,
    private readonly ground: GroundGuideWorkspace,
    saved: DeepReadonly<AnimationPreviewPreferences> | undefined,
    private readonly changed: (preferences: DeepReadonly<AnimationPreviewPreferences>) => void,
  ) {
    if (saved) {
      const preferences = freezeData(animationPreviewPreferencesSchema.parse(saved));
      environment.restorePreferences(preferences.environment, preferences.camera);
      motion.restorePreferences(preferences.animations);
      ground.restore(preferences.ground);
    }
    this.current = this.capture();
    this.baseline = this.current;
    this.imageRevision = environment.images.getSnapshot();
    this.releases = [environment.subscribe(this.sync), motion.subscribe(this.sync), ground.subscribe(this.sync)];
  }
  private capture(): DeepReadonly<AnimationPreviewPreferences> {
    const { settings: environment, camera } = this.environment.getSnapshot();
    return Object.freeze({
      environment,
      camera,
      ground: this.ground.getSnapshot().guide,
      animations: this.motion.capturePreferences(),
    });
  }
  readonly sync = (): void => {
    // Ground gestures persist atomically on release, just like the existing preference history.
    if (this.ground.getSnapshot().dragging) return;
    const next = this.capture();
    const imageRevision = this.environment.images.getSnapshot();
    if (equalJsonData(next, this.current) && imageRevision === this.imageRevision) return;
    this.current = next;
    this.imageRevision = imageRevision;
    this.changed(next);
  };
  get preferences(): DeepReadonly<AnimationPreviewPreferences> {
    return this.current;
  }
  get dirty(): boolean {
    return !equalJsonData(this.current, this.baseline) || this.environment.images.entries.length > 0;
  }
  dispose(): void {
    for (const release of this.releases) release();
  }
}
