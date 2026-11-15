import {
  applyCinematicCamera,
  type CameraViewport,
  type CinematicCameraState,
  type CinematicCameraTarget,
} from '../../engine/core.js';

interface PreviewCamera extends CinematicCameraTarget {
  readonly x: number;
  readonly y: number;
  scrollX: number;
  scrollY: number;
  readonly zoom: number;
}
/** Saves navigation once per preview, restoring it exactly on exit. Never owns authored state. */
export class SceneCameraPreview {
  private saved: (CameraViewport & { scrollX: number; scrollY: number; zoom: number }) | undefined;
  constructor(private readonly camera: PreviewCamera) {}
  sync(enabled: boolean, state: Readonly<CinematicCameraState>, viewport: CameraViewport): void {
    const camera = this.camera;
    if (enabled) {
      this.saved ??= {
        x: camera.x,
        y: camera.y,
        width: camera.width,
        height: camera.height,
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
        zoom: camera.zoom,
      };
      applyCinematicCamera(camera, state, viewport);
    } else if (this.saved) {
      const saved = this.saved;
      this.saved = undefined;
      camera.setViewport(saved.x, saved.y, saved.width, saved.height);
      camera.setZoom(saved.zoom);
      camera.scrollX = saved.scrollX;
      camera.scrollY = saved.scrollY;
    }
  }
}
