import type Phaser from 'phaser';
import { groundGuideGeometry, type GroundGuide } from './groundGuide.js';

/** Independent editor-only objects: no texture changes, input handlers or authored mutations. */
export class GroundGuideOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private disposed = false;
  private signature = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: { dashed?: boolean; showLabel?: boolean; draggable?: boolean } = {},
  ) {
    this.graphics = scene.add.graphics().setDepth(9000).setVisible(false);
    this.label = scene.add
      .text(0, 0, options.draggable ? '↕ Ground' : 'Ground', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#dba75d',
        backgroundColor: '#25252c',
        padding: { x: 3, y: 2 },
      })
      .setDepth(9001)
      .setVisible(false);
  }

  render(guide: GroundGuide): void {
    if (this.disposed) return;
    const geometry = groundGuideGeometry(guide, this.scene.cameras.main);
    const signature = JSON.stringify(geometry);
    if (signature === this.signature) return;
    this.signature = signature;
    this.graphics.clear().setVisible(geometry !== null);
    this.label.setVisible(geometry !== null && this.options.showLabel !== false);
    if (!geometry) return;
    const { left, right, y, pixel, labelX, labelY } = geometry;
    this.graphics.lineStyle(2 * pixel, 0xdba75d, 0.9);
    if (this.options.dashed === false) this.graphics.lineBetween(left, y, right, y);
    else {
      const width = (right - left) / pixel;
      // Bound work on pathological viewport sizes and avoid precision-stalled world-coordinate loops.
      const stride = Math.max(16, width / 4096);
      for (let offset = 0; offset < width; offset += stride) {
        this.graphics.lineBetween(
          left + offset * pixel,
          y,
          Math.min(right, left + (offset + stride * 0.625) * pixel),
          y,
        );
      }
    }
    this.label.setPosition(labelX, labelY).setScale(pixel);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.graphics.destroy();
    this.label.destroy();
  }
}
