import type Phaser from 'phaser';
import { cinematicFrame, DEFAULT_CINEMATIC_CAMERA, type CinematicCameraState } from './cinematicCamera.js';
import { CLEAR_SCENE_TRANSITION, type SceneTransitionState, type SceneTransitionTarget } from './sceneTransitions.js';

/** Full output-frame color, above all scene bands (max 6201), below editor guides (9000).
 * No tween or update listener: the host/runner supplies scene-clock samples. One overlay
 * belongs to one output camera; hosts with multiple cameras should ignore it elsewhere.
 */
export class SceneTransitionOverlay implements SceneTransitionTarget {
  private graphics: Phaser.GameObjects.Graphics | undefined;
  private state = CLEAR_SCENE_TRANSITION;
  private camera: Readonly<CinematicCameraState> = DEFAULT_CINEMATIC_CAMERA;
  private outputCamera: Phaser.Cameras.Scene2D.Camera | undefined;
  constructor(
    private readonly scene: Phaser.Scene,
    depth = 8000,
  ) {
    this.graphics = scene.add.graphics().setDepth(depth);
    scene.events.once('shutdown', this.dispose);
  }
  setOutputCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.outputCamera = camera;
    this.render();
  }
  setCamera(camera: Readonly<CinematicCameraState>): void {
    this.camera = camera;
    this.render();
  }
  setTransition(state: SceneTransitionState): void {
    this.state = state;
    this.render();
  }
  private render(): void {
    const graphics = this.graphics;
    if (!graphics) return;
    graphics.clear();
    if (this.state.opacity <= 0) return;
    const output = this.outputCamera;
    const frame = output
      ? {
          x: output.scrollX + output.width / 2 - output.width / (2 * output.zoom),
          y: output.scrollY + output.height / 2 - output.height / (2 * output.zoom),
          width: output.width / output.zoom,
          height: output.height / output.zoom,
        }
      : cinematicFrame(this.camera);
    graphics.fillStyle(Number.parseInt(this.state.color.slice(1), 16), this.state.opacity);
    graphics.fillRect(frame.x, frame.y, frame.width, frame.height);
  }
  readonly dispose = (): void => {
    this.scene.events.off('shutdown', this.dispose);
    this.graphics?.destroy();
    this.graphics = undefined;
  };
}
