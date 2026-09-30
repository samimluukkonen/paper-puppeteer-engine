import type Phaser from 'phaser';
import type { Bone } from './Bone.js';
import type { Facing } from './types.js';

/** Scene-space labels remain readable when the puppet is mirrored. */
export class PuppetDebug {
  readonly container: Phaser.GameObjects.Container;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private readonly labelSides = new Map<string, Facing>();

  constructor(
    scene: Phaser.Scene,
    private readonly bones: ReadonlyMap<string, Bone>,
  ) {
    this.container = scene.add.container(0, 0).setVisible(false);
    this.graphics = scene.add.graphics();
    this.container.add(this.graphics);
    for (const bone of bones.values()) {
      const label = scene.add.text(0, 0, bone.id, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#143e37',
        backgroundColor: '#f9f5e9',
        padding: { x: 3, y: 2 },
      });
      this.labels.set(bone.id, label);
      this.container.add(label);
    }
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
    if (visible) this.update();
  }

  setLabelSide(boneId: string, side?: Facing): void {
    if (!this.bones.has(boneId)) throw new Error(`Unknown bone "${boneId}".`);
    if (side !== undefined && side !== 'left' && side !== 'right')
      throw new Error(`Invalid label side: ${String(side)}.`);
    if (this.labelSides.get(boneId) === side) return;
    if (side === undefined) this.labelSides.delete(boneId);
    else this.labelSides.set(boneId, side);
    this.update();
  }

  update(): void {
    if (!this.container.visible) return;
    this.graphics.clear();
    this.graphics.lineStyle(2, 0x287b68, 0.9);
    for (const bone of this.bones.values()) {
      const position = bone.getWorldPosition();
      const parent = bone.parentId ? this.bones.get(bone.parentId) : undefined;
      if (parent) {
        const parentPosition = parent.getWorldPosition();
        this.graphics.lineBetween(parentPosition.x, parentPosition.y, position.x, position.y);
      }
      this.graphics.fillStyle(0xf9f5e9, 1);
      this.graphics.fillCircle(position.x, position.y, 5);
      this.graphics.strokeCircle(position.x, position.y, 5);
      this.graphics.lineBetween(position.x - 8, position.y, position.x + 8, position.y);
      this.graphics.lineBetween(position.x, position.y - 8, position.x, position.y + 8);
      if (bone.sprite) {
        const matrix = bone.sprite.getWorldTransformMatrix();
        this.graphics.fillStyle(0xc86d40, 1);
        this.graphics.fillCircle(matrix.tx, matrix.ty, 2);
      }
      const override = this.labelSides.get(bone.id);
      const side =
        override === 'left'
          ? -1
          : override === 'right'
            ? 1
            : position.x < (parent?.getWorldPosition().x ?? position.x)
              ? -1
              : 1;
      this.labels
        .get(bone.id)
        ?.setPosition(position.x + side * 12, position.y - 12)
        .setOrigin(side === -1 ? 1 : 0, 0.5);
    }
  }

  destroy(): void {
    this.container.destroy();
    this.labels.clear();
    this.labelSides.clear();
  }
}
