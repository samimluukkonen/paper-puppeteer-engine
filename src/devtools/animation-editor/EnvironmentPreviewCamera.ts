import type { AnimationEditorState } from './AnimationEditorState.js';
import type { EnvironmentPreviewController } from './EnvironmentPreviewController.js';
import { evaluatePreviewDisplacement, motionPreviewSampleTime } from './motionPreview.js';
import type { MotionPreviewController } from './MotionPreviewController.js';
import { previewCameraCenter } from './previewCamera.js';

interface Camera {
  scrollX: number;
  scrollY: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  setZoom(zoom: number): unknown;
  centerOn(x: number, y: number): unknown;
}

/** Borrows the existing world camera; owns no clock, Actor, authored camera or animation. */
export class EnvironmentPreviewCamera {
  private saved: { x: number; y: number; zoom: number } | undefined;
  private applied: { x: number; y: number; zoom: number; width: number; height: number } | undefined;
  private readonly releases: (() => void)[];
  private disposed = false;

  constructor(
    private readonly camera: Camera,
    private readonly state: AnimationEditorState,
    private readonly environment: EnvironmentPreviewController,
    private readonly motion: MotionPreviewController,
  ) {
    this.releases = [state.subscribe(this.sync), environment.subscribe(this.sync), motion.subscribe(this.sync)];
    this.sync();
  }

  private displacement() {
    return evaluatePreviewDisplacement(
      this.motion.getSnapshot().settings,
      motionPreviewSampleTime(this.state.previewAnimation, this.state.previewTimeMilliseconds),
    );
  }

  private readonly sync = (): void => {
    if (this.disposed) return;
    const { settings, camera: config } = this.environment.getSnapshot();
    if (!settings.enabled || !this.state.animationAuthoringEnabled) {
      this.restore();
      return;
    }
    const camera = this.camera;
    this.saved ??= { x: camera.scrollX, y: camera.scrollY, zoom: camera.zoom };
    const center = previewCameraCenter(config, this.state.previewAnimation ? this.displacement() : { x: 0, y: 0 });
    if (camera.zoom !== config.zoom) camera.setZoom(config.zoom);
    if (camera.scrollX !== center.x - camera.width / 2 || camera.scrollY !== center.y - camera.height / 2)
      camera.centerOn(center.x, center.y);
    this.applied = {
      x: camera.scrollX,
      y: camera.scrollY,
      zoom: camera.zoom,
      width: camera.width,
      height: camera.height,
    };
  };

  /** Retain native pan/wheel navigation as preview configuration, including a follow offset. */
  render(): void {
    if (this.disposed || !this.applied) return;
    const camera = this.camera;
    const previous = this.applied;
    if (camera.width !== previous.width || camera.height !== previous.height) {
      this.sync();
    } else if (camera.scrollX !== previous.x || camera.scrollY !== previous.y || camera.zoom !== previous.zoom) {
      const { camera: config } = this.environment.getSnapshot();
      const offset = config.mode === 'follow' && this.state.previewAnimation ? this.displacement() : { x: 0, y: 0 };
      this.environment.updateCamera({
        x: camera.scrollX + camera.width / 2 - offset.x,
        y: camera.scrollY + camera.height / 2 - offset.y,
        zoom: camera.zoom,
      });
    }
  }

  private restore(): void {
    if (this.saved) {
      this.camera.setZoom(this.saved.zoom);
      this.camera.scrollX = this.saved.x;
      this.camera.scrollY = this.saved.y;
      this.saved = undefined;
    }
    this.applied = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases) release();
    this.restore();
  }
}
