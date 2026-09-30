import Phaser from 'phaser';
import type { Bone } from '../Bone.js';
import type { TwoBoneIKConstraint } from './TwoBoneIKConstraint.js';

/** World-space visualization, separate from the solver and constraint math. */
export class IKDebug {
  readonly container: Phaser.GameObjects.Container;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly bones: ReadonlyMap<string, Bone>,
  ) {
    this.container = scene.add.container(0, 0).setVisible(false);
    this.graphics = scene.add.graphics();
    this.container.add(this.graphics);
  }

  update(constraints: readonly TwoBoneIKConstraint[]): void {
    if (!this.container.visible) return;
    this.graphics.clear();
    const labelBounds: Phaser.Geom.Rectangle[] = [];
    for (const label of this.labels.values()) label.setVisible(false);
    for (const [index, constraint] of constraints.entries()) {
      const target = constraint.resolvedTarget;
      if (!target) continue;
      const root = this.bones.get(constraint.rootBone)!.getWorldPosition();
      const middle = this.bones.get(constraint.middleBone)!.getWorldPosition();
      const endBone = this.bones.get(constraint.endBone)!;
      const wrist = endBone.getWorldPosition();
      const end = endBone.container
        .getWorldTransformMatrix()
        .transformPoint(constraint.endOffset.x, constraint.endOffset.y);
      const color = [0x7652ad, 0x337db1, 0xcb674f, 0xb18a22][index % 4]!;
      this.graphics.lineStyle(2, color, 0.9);
      this.graphics.lineBetween(root.x, root.y, middle.x, middle.y);
      this.graphics.lineBetween(middle.x, middle.y, end.x, end.y);
      this.graphics.lineStyle(1, color, 0.45).lineBetween(end.x, end.y, target.x, target.y);
      for (const joint of [root, middle, end]) {
        this.graphics.fillStyle(0xf9f5e9).fillCircle(joint.x, joint.y, 4);
        this.graphics.lineStyle(2, color).strokeCircle(joint.x, joint.y, 4);
      }
      if (constraint.endOffset.x !== 0 || constraint.endOffset.y !== 0) {
        this.graphics.fillStyle(color).fillCircle(wrist.x, wrist.y, 3);
      }
      this.graphics.strokeCircle(target.x, target.y, 9);
      this.graphics.lineBetween(target.x - 13, target.y, target.x + 13, target.y);
      this.graphics.lineBetween(target.x, target.y - 13, target.x, target.y + 13);
      let label = this.labels.get(constraint.name);
      if (!label) {
        label = this.scene.add.text(0, 0, '', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#513d69',
          backgroundColor: '#f9f5e9',
          padding: { x: 3, y: 2 },
        });
        this.labels.set(constraint.name, label);
        this.container.add(label);
      }
      label
        .setVisible(true)
        .setPosition(target.x + 15, target.y + 12)
        .setText(
          `${constraint.name} · bend ${constraint.bendDirection}\n` +
            `A ${constraint.lengthA.toFixed(1)} / B ${constraint.lengthB.toFixed(1)} · ${constraint.status}`,
        );
      let bounds = label.getBounds();
      let overlap = labelBounds.find((other) => Phaser.Geom.Rectangle.Overlaps(bounds, other));
      while (overlap) {
        label.setY(overlap.bottom + 4);
        bounds = label.getBounds();
        overlap = labelBounds.find((other) => Phaser.Geom.Rectangle.Overlaps(bounds, other));
      }
      labelBounds.push(bounds);
    }
  }

  destroy(): void {
    this.container.destroy();
    this.labels.clear();
  }
}
