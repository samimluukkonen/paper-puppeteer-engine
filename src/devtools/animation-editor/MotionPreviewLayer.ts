import type Phaser from 'phaser';
import { CHARACTER_PREVIEW_ORIGIN } from '../shared/previewPlacement.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { evaluatePreviewDisplacement } from './motionPreview.js';
import type { MotionPreviewController } from './MotionPreviewController.js';

/** Separate world-space guide: no input, background artwork, rig objects or authored keys. */
export class MotionPreviewLayer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: AnimationEditorState,
    private readonly controller: MotionPreviewController,
  ) {
    this.graphics = scene.add.graphics().setDepth(4).setName('animation-preview-trajectory');
  }
  render(): void {
    const { settings } = this.controller.getSnapshot();
    this.graphics.clear();
    if (
      !this.state.animationAuthoringEnabled ||
      !this.state.previewAnimation ||
      !settings.enabled ||
      !settings.showTrajectory
    )
      return;
    const duration = this.state.previewAnimation.duration;
    const times = [
      0,
      ...settings.positionKeys.filter((key) => key.time > 0 && key.time < duration).map((key) => key.time),
      duration,
    ];
    const zoom = this.scene.cameras.main.zoom;
    this.graphics.lineStyle(1.5 / zoom, 0x58a6ff, 0.8);
    let previous: { x: number; y: number } | undefined;
    for (const time of times) {
      const offset = evaluatePreviewDisplacement(settings, time);
      const point = { x: CHARACTER_PREVIEW_ORIGIN.x + offset.x, y: CHARACTER_PREVIEW_ORIGIN.y + offset.y };
      if (previous) this.graphics.lineBetween(previous.x, previous.y, point.x, point.y);
      this.graphics.strokeCircle(point.x, point.y, 3 / zoom);
      previous = point;
    }
  }
  dispose(): void {
    this.graphics.destroy();
  }
}
