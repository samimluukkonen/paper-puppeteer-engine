import type Phaser from 'phaser';
import { demoLimbColors } from './demoLimbColors.js';

const outline = 0x3e433c;

/** Temporary transparent cutouts, generated locally without an asset pipeline. */
export function createTextures(scene: Phaser.Scene): void {
  const graphics = scene.add.graphics();
  const piece = (key: string, width: number, height: number, color: number, detail?: () => void): void => {
    if (scene.textures.exists(key)) return;
    graphics.clear();
    graphics.fillStyle(color).lineStyle(2, outline, 0.9);
    graphics.fillRoundedRect(2, 2, width - 4, height - 4, Math.min(width / 3, 12));
    graphics.strokeRoundedRect(2, 2, width - 4, height - 4, Math.min(width / 3, 12));
    // Fixed flecks suggest paper grain without adding noise to joint silhouettes.
    graphics.fillStyle(0xffffff, 0.16);
    for (let index = 0; index < 20; index += 1) {
      const x = 5 + ((index * 17 + 7) % Math.max(1, width - 10));
      const y = 5 + ((index * 23 + 3) % Math.max(1, height - 10));
      graphics.fillRect(x, y, 2, 1);
    }
    detail?.();
    graphics.generateTexture(key, width, height);
  };
  const pin = (x: number, y: number): void => {
    graphics.fillStyle(0xf1ddad).fillCircle(x, y, 4);
    graphics.lineStyle(1, outline, 0.65).strokeCircle(x, y, 4);
    graphics.fillStyle(outline).fillCircle(x, y, 1);
  };
  piece('paper-torso', 82, 105, 0x698e83, () => {
    graphics.lineStyle(1, 0xe8ecdd, 0.6).lineBetween(41, 12, 41, 95);
    pin(41, 97);
  });
  piece('paper-pelvis', 68, 40, 0x4e7067, () => {
    graphics.fillStyle(0xdec29a).fillRect(4, 6, 60, 8);
    pin(34, 16);
  });
  piece('paper-head', 60, 68, 0xe7c69b, () => {
    graphics.fillStyle(outline).fillCircle(22, 27, 2).fillCircle(41, 27, 2);
    graphics.lineStyle(2, outline, 0.8).lineBetween(28, 43, 37, 43);
    graphics.fillStyle(0xbd7355, 0.4).fillCircle(16, 36, 4).fillCircle(47, 36, 4);
    pin(30, 58.48);
  });
  piece('paper-helmet-head', 60, 68, 0xd0b899, () => {
    graphics.fillStyle(0x556b78).fillRoundedRect(5, 3, 50, 29, 10);
    graphics.lineStyle(2, 0xe5c27b).lineBetween(10, 29, 50, 29);
    graphics.fillStyle(outline).fillCircle(22, 39, 2).fillCircle(41, 39, 2);
  });
  piece('paper-armor-torso', 82, 105, 0x647987, () => {
    graphics.lineStyle(3, 0xd5ad68).strokeRoundedRect(10, 10, 62, 85, 8);
    graphics.fillStyle(0xd5ad68).fillCircle(41, 42, 7);
  });
  piece('paper-armor-pelvis', 68, 40, 0x536b7b, () => {
    graphics.fillStyle(0xd5ad68).fillRect(6, 10, 56, 6);
  });
  piece('paper-right-grip-hand', 26, 34, demoLimbColors.rightArm.color, () => {
    graphics.fillStyle(outline).fillRoundedRect(5, 17, 17, 8, 4);
    pin(13, 6.8);
  });
  piece('paper-kabuto', 74, 43, 0x4d606e, () => {
    graphics.fillStyle(0xe2b462).fillTriangle(37, 2, 29, 22, 45, 22);
    graphics.lineStyle(3, 0xe2b462).lineBetween(5, 33, 69, 33);
  });
  if (!scene.textures.exists('paper-slot-katana')) {
    graphics.clear();
    graphics.fillStyle(0x72503c).fillRoundedRect(1, 8, 38, 9, 3);
    graphics.fillStyle(0xb49a50).fillRect(39, 3, 7, 20);
    graphics.fillStyle(0xcbd5d3).fillTriangle(46, 9, 148, 9, 138, 16);
    graphics.fillTriangle(46, 9, 138, 16, 46, 16);
    graphics.generateTexture('paper-slot-katana', 150, 25);
  }
  for (const side of ['left', 'right'] as const) {
    const armColor = demoLimbColors[`${side}Arm`].color;
    const legColor = demoLimbColors[`${side}Leg`].color;
    piece(`paper-${side}-upper-arm`, 28, 78, armColor, () => {
      pin(14, 12);
    });
    piece(`paper-${side}-forearm`, 24, 67, armColor, () => {
      pin(12, 12);
    });
    piece(`paper-${side}-hand`, 26, 34, armColor, () => {
      pin(13, 6.8);
    });
    piece(`paper-${side}-thigh`, 34, 88, legColor, () => {
      pin(17, 14);
    });
    piece(`paper-${side}-shin`, 28, 80, legColor, () => {
      pin(14, 12);
    });
    piece(`paper-${side}-foot`, 52, 26, legColor, () => {
      pin(14.56, 7.8);
    });
  }

  if (!scene.textures.exists('paper-prop')) {
    graphics.clear();
    graphics.fillStyle(0x7f634a).fillRoundedRect(2, 2, 6, 92, 2);
    graphics.fillStyle(0xcc744f);
    graphics.fillTriangle(8, 5, 62, 12, 8, 40);
    graphics.lineStyle(1, outline, 0.8).strokeTriangle(8, 5, 62, 12, 8, 40);
    graphics.lineStyle(1, 0xf5dcb0, 0.8).lineBetween(12, 12, 40, 16);
    graphics.generateTexture('paper-prop', 66, 96);
  }
  graphics.destroy();
}
