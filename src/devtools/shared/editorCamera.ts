interface EditorCamera {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
  setZoom(zoom: number): void;
}

export interface EditorViewportCamera {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
}

/** Current world bounds without waiting for Phaser's next preRender matrix refresh.
 * Editor cameras use uniform zoom and no rotation or external camera transform.
 */
export function editorWorldViewport(camera: EditorViewportCamera) {
  const { scrollX, scrollY, zoom, width, height, originX, originY } = camera;
  if (
    ![scrollX, scrollY, zoom, width, height, originX, originY].every(Number.isFinite) ||
    zoom <= 0 ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const left = scrollX + width * originX * (1 - 1 / zoom);
  const top = scrollY + height * originY * (1 - 1 / zoom);
  const right = left + width / zoom;
  const bottom = top + height / zoom;
  return [left, top, right, bottom].every(Number.isFinite) ? { left, top, right, bottom } : null;
}

/** Convert a drag in screen pixels to camera scroll in world units. */
export function panCamera(camera: EditorCamera, deltaX: number, deltaY: number): void {
  camera.scrollX -= deltaX / camera.zoom;
  camera.scrollY -= deltaY / camera.zoom;
}

/** Keep the world point under viewport-local x/y fixed while zooming a centered camera. */
export function zoomCameraAt(camera: EditorCamera, x: number, y: number, deltaY: number): void {
  const oldZoom = camera.zoom;
  const nextZoom = Math.max(0.35, Math.min(4, oldZoom * Math.exp(-deltaY * 0.001)));
  camera.scrollX += (x - camera.width / 2) * (1 / oldZoom - 1 / nextZoom);
  camera.scrollY += (y - camera.height / 2) * (1 / oldZoom - 1 / nextZoom);
  camera.setZoom(nextZoom);
}
