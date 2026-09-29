import Phaser from 'phaser';
import type { IKTarget } from '../engine/index.js';

export interface WeaponGripDefinition {
  x: number;
  y: number;
}

export const katanaGrips = {
  primary: { x: 0, y: 0 },
  secondary: { x: -26, y: 0 },
} satisfies Record<string, WeaponGripDefinition>;

/** Small demo prop; grip coordinates belong to the weapon's own transform. */
export class Katana {
  readonly container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0).setName('katana');
    const graphics = scene.add.graphics();
    graphics.fillStyle(0x72503c).fillRoundedRect(-40, -5, 50, 10, 3);
    graphics.lineStyle(2, 0xe1be84);
    for (let x = -36; x < 9; x += 7) graphics.lineBetween(x, -4, x + 4, 4);
    graphics.fillStyle(0xb49a50).fillRoundedRect(9, -13, 6, 26, 2);
    graphics.fillStyle(0xcbd5d3).fillTriangle(15, -4, 138, -4, 126, 5);
    graphics.fillTriangle(15, -4, 126, 5, 15, 5);
    graphics.lineStyle(1, 0x536965).lineBetween(15, -4, 138, -4).lineBetween(138, -4, 126, 5);
    graphics.lineStyle(1, 0xffffff, 0.9).lineBetween(18, 3, 122, 3);
    for (const grip of Object.values(katanaGrips)) {
      graphics.fillStyle(0xf1ddad).fillCircle(grip.x, grip.y, 2);
    }
    this.container.add(graphics);
  }

  getGripWorldPosition(grip: WeaponGripDefinition): IKTarget {
    const point = this.container.getWorldTransformMatrix().transformPoint(grip.x, grip.y);
    return { x: point.x, y: point.y };
  }
}
