import { readFileSync } from 'node:fs';
import { puppetScene } from './puppetScene.js';

/** Real cutout dimensions make grip correction and head clearance representative of the demo. */
export function demoPuppetScene() {
  const scene = puppetScene();
  const originalImage = scene.add.image.bind(scene.add);
  scene.add.image = (x, y, texture, frame) => {
    if (typeof texture !== 'string') throw new Error('Demo artwork requires a string texture key.');
    const image = originalImage(x, y, texture, frame);
    const png = readFileSync(new URL(`../../public/characters/demo-puppet/images/${texture}.png`, import.meta.url));
    image.width = png.readUInt32BE(16);
    image.height = png.readUInt32BE(20);
    return image;
  };
  return scene;
}
