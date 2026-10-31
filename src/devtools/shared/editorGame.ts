import Phaser from 'phaser';

/** Shared rendering and scaling defaults for the editor preview canvases. */
export function createEditorGame(parent: string, scene: Phaser.Scene, size = { width: 760, height: 640 }): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    ...size,
    transparent: true,
    // Let Phaser batch separate artwork textures up to its GPU-clamped default limit.
    render: { antialias: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene],
  });
}

/** Complete Phaser's deferred destruction before a project removes a suspended iframe. */
export function destroyEditorGame(game: Phaser.Game): void {
  game.destroy(true);
  if (game.isRunning) game.loop.tick();
}
