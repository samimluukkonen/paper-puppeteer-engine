import { SceneImageRegistry } from '../scene-editor/SceneImageRegistry.js';
import {
  DEFAULT_ENVIRONMENT_PREVIEW,
  updateEnvironmentPreview,
  type EnvironmentPreviewSettings,
} from '../shared/environmentPreview.js';
import { DEFAULT_PREVIEW_CAMERA, type PreviewCameraSettings, updatePreviewCamera } from './previewCamera.js';

export interface EnvironmentProjectImage {
  readonly id: string;
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

/** One workspace owner; switching clips never changes these preferences or authored history. */
export class EnvironmentPreviewController {
  private snapshot = {
    settings: DEFAULT_ENVIRONMENT_PREVIEW,
    camera: DEFAULT_PREVIEW_CAMERA,
    busy: false,
    message: '',
    error: '',
    projectImages: [] as readonly EnvironmentProjectImage[],
  };
  private readonly listeners = new Set<() => void>();
  private request: AbortController | undefined;
  private alive = true;
  private readonly releaseImages: () => void;
  readonly images: SceneImageRegistry;
  private readonly ownsImages: boolean;
  constructor(images?: SceneImageRegistry) {
    this.images = images ?? new SceneImageRegistry();
    this.ownsImages = !images;
    this.releaseImages = this.images.subscribe(() => this.publish({}));
  }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.snapshot;
  private publish(patch: Partial<typeof this.snapshot>): void {
    if (!this.alive) return;
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of Array.from(this.listeners)) listener();
  }
  update(patch: Partial<EnvironmentPreviewSettings>): void {
    if (!this.alive) return;
    this.publish({ settings: updateEnvironmentPreview(this.snapshot.settings, patch) });
  }
  updateCamera(patch: Partial<PreviewCameraSettings>): void {
    this.publish({ camera: updatePreviewCamera(this.snapshot.camera, patch) });
  }
  resetCamera(): void {
    this.publish({ camera: DEFAULT_PREVIEW_CAMERA });
  }
  clear(): void {
    this.request?.abort();
    this.request = undefined;
    this.publish({
      settings: updateEnvironmentPreview(this.snapshot.settings, { image: null }),
      busy: false,
      message: '',
      error: '',
    });
  }
  resetTransform(): void {
    this.update({ x: 0, y: 0, scale: 1 });
  }
  reset(): void {
    this.clear();
    this.publish({ settings: DEFAULT_ENVIRONMENT_PREVIEW, camera: DEFAULT_PREVIEW_CAMERA });
  }
  /** Align the image's bottom edge; interior floor levels can be placed with Background Y. */
  alignBottom(groundY: number): void {
    const settings = this.snapshot.settings;
    const image = this.images.entries.find((entry) => entry.reference === settings.image);
    if (image && Number.isFinite(groundY)) this.update({ y: groundY - (image.height * settings.scale) / 2 });
  }
  setRenderError = (error: string): void => {
    if (error !== this.snapshot.error) this.publish({ error });
  };
  async import(file: File): Promise<void> {
    await this.run(async (signal) => {
      const image = await this.images.import(file, signal);
      signal.throwIfAborted();
      this.update({ image });
      return `${file.name} imported into the image library.`;
    });
  }
  async loadProjectImages(load: () => Promise<readonly EnvironmentProjectImage[]>): Promise<void> {
    await this.run(async (signal) => {
      const choices = await load();
      signal.throwIfAborted();
      this.publish({ projectImages: choices });
      return choices.length ? 'Project images are available in Background.' : 'No character images in this project.';
    });
  }
  async selectProjectImage(id: string): Promise<void> {
    const choice = this.snapshot.projectImages.find((image) => image.id === id);
    if (!choice) return;
    await this.run(async (signal) => {
      const image = await this.images.add(choice.bytes, choice.name, signal);
      signal.throwIfAborted();
      this.update({ image });
      return `${choice.name} selected from the project.`;
    });
  }
  private async run(operation: (signal: AbortSignal) => Promise<string>): Promise<void> {
    if (!this.alive) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.publish({ busy: true, message: '' });
    try {
      const message = await operation(request.signal);
      if (!request.signal.aborted) this.publish({ message });
    } catch (error) {
      if (!request.signal.aborted) this.publish({ message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.request === request) {
        this.request = undefined;
        this.publish({ busy: false });
      }
    }
  }
  dispose(): void {
    this.alive = false;
    this.request?.abort();
    this.request = undefined;
    this.releaseImages();
    if (this.ownsImages) this.images.removeUnused(new Set());
    this.snapshot = { ...this.snapshot, projectImages: [] };
    this.listeners.clear();
  }
}
