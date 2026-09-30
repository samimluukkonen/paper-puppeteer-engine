import type Phaser from 'phaser';
import type { PuppetRenderer } from './PuppetRenderer.js';
import type { Rig } from './Rig.js';
import type { SlotState } from './SlotState.js';

/** Scene-space overlay, independent of slot attachment selection and posing. */
export class SlotDebug {
  readonly container: Phaser.GameObjects.Container;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();

  constructor(
    scene: Phaser.Scene,
    private readonly rig: Rig,
    private readonly renderer: PuppetRenderer,
    private readonly state: SlotState,
  ) {
    this.container = scene.add.container(0, 0).setVisible(false);
    this.graphics = scene.add.graphics();
    this.container.add(this.graphics);
    for (const slot of rig.slots) {
      const label = scene.add.text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#452c62',
        backgroundColor: '#fff2cd',
        padding: { x: 3, y: 1 },
      });
      this.labels.set(slot.id, label);
      this.container.add(label);
    }
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
    this.update();
  }

  update(): void {
    if (!this.container.visible) return;
    this.graphics.clear();
    this.graphics.fillStyle(0xfff8e9, 0.92).fillRoundedRect(8, 50, 230, this.rig.slots.length * 30 + 16, 6);
    this.graphics.lineStyle(1, 0x8a4db1, 0.9);
    for (const [index, slot] of this.rig.slots.entries()) {
      const matrix = this.renderer.getSlotMount(slot.id).getWorldTransformMatrix();
      const x = matrix.tx;
      const y = matrix.ty;
      this.graphics
        .strokeCircle(x, y, 5)
        .lineBetween(x - 8, y, x + 8, y)
        .lineBetween(x, y - 8, x, y + 8);
      this.labels
        .get(slot.id)
        ?.setText(`${slot.id}\n${slot.bone} → ${this.state.getAttachment(slot.id) ?? 'empty'}`)
        .setPosition(16, 58 + index * 30);
    }
  }

  destroy(): void {
    this.container.destroy();
    this.labels.clear();
  }
}
