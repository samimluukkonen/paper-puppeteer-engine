import type Phaser from 'phaser';

/** Keep Phaser's FIT bounds current when a panel or the viewport changes size. */
export function observePreview(host: HTMLElement, game: Phaser.Game): () => void {
  let frame = 0;
  const observer = new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      game.scale.getParentBounds();
      game.scale.refresh();
    });
  });
  observer.observe(host);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
