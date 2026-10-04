import Phaser from 'phaser';

/** Shared rendering and scaling defaults for the editor preview canvases. */
export function createEditorGame(parent: string, scene: Phaser.Scene): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 760,
    height: 640,
    transparent: true,
    render: { antialias: true, maxTextures: 1 },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene],
  });
}
