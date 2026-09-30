import Phaser from 'phaser';
import { Joint } from './Joint.js';
import type { BoneDefinition } from './types.js';

/** A joint's renderer: the container origin is always its rotational pivot. */
export class Bone extends Joint {
  readonly container: Phaser.GameObjects.Container;
  readonly sprite: Phaser.GameObjects.Image | undefined;
  readonly parentId: string | undefined;

  constructor(scene: Phaser.Scene, definition: BoneDefinition) {
    super(definition.id, definition);
    this.parentId = definition.parent;
    this.container = scene.add.container(0, 0).setName(definition.id);
    this.container.setDepth(definition.depth ?? 0);
    const sprite = definition.sprite;
    if (sprite) {
      this.sprite = scene.add
        .image(sprite.x ?? 0, sprite.y ?? 0, sprite.texture, sprite.frame)
        .setOrigin(sprite.originX ?? 0.5, sprite.originY ?? 0.5)
        .setScale(sprite.scaleX ?? 1, sprite.scaleY ?? 1)
        .setDepth(sprite.depth ?? 0);
      this.container.add(this.sprite);
    }
    this.syncTransform();
  }

  syncTransform(): void {
    this.container.setPosition(this.pose.x, this.pose.y);
    this.container.setRotation(this.pose.rotation);
    this.container.setScale(this.pose.scaleX, this.pose.scaleY);
  }

  getWorldPosition(): Phaser.Math.Vector2 {
    const matrix = this.container.getWorldTransformMatrix();
    return new Phaser.Math.Vector2(matrix.tx, matrix.ty);
  }
}
