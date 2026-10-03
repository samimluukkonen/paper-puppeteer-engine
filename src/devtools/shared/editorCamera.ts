interface EditorCamera {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
  setZoom(zoom: number): void;
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
