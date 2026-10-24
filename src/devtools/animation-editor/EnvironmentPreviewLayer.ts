import type Phaser from 'phaser';
import { SceneImageLayer } from '../../engine/SceneImageLayer.js';
import { environmentPreviewImages } from '../shared/environmentPreview.js';
import type { EnvironmentPreviewController } from './EnvironmentPreviewController.js';

/** Independent world artwork behind the existing Puppet, using the scene image loading/cleanup path. */
export class EnvironmentPreviewLayer {
  private readonly layer: SceneImageLayer;
  private readonly release: () => void;
  private revision: number;
  private active = false;
  constructor(
    scene: Phaser.Scene,
    private readonly controller: EnvironmentPreviewController,
  ) {
    this.layer = new SceneImageLayer(
      scene,
      (reference) => Promise.resolve(controller.images.read(reference)),
      controller.setRenderError,
    );
    this.revision = controller.images.getSnapshot();
    this.release = controller.subscribe(() => {
      this.sync();
      const revision = controller.images.getSnapshot();
      if (this.revision !== revision) {
        this.revision = revision;
        this.layer.retry();
      }
    });
  }
  setActive(active: boolean): void {
    this.active = active;
    this.sync();
  }
  private sync(): void {
    const settings = this.controller.getSnapshot().settings;
    const missing =
      this.active &&
      settings.enabled &&
      settings.visible &&
      !!settings.image &&
      !this.controller.images.has(settings.image);
    this.layer.sync(this.active && !missing ? environmentPreviewImages(settings) : []);
    this.controller.setRenderError(
      missing ? `Missing image "${settings.image}". Select or import another background.` : this.layer.error,
    );
  }
  dispose(): void {
    this.release();
    this.layer.dispose();
    this.controller.setRenderError('');
  }
}
