import type Phaser from 'phaser';
import { sampleRootMotion } from '../../engine/core.js';
import type { Affine, Point } from '../../engine/data.js';
import type { Puppet } from '../../engine/runtime.js';
import type { AnimationEditorState } from './AnimationEditorState.js';

/** The root handle drives the root-motion handle; the rest is the session and the evaluated preview. */
type RootHandleState = Pick<
  AnimationEditorState,
  'rootMotion' | 'subscribe' | 'animationAuthoringEnabled' | 'previewAnimation'
>;
import { pointerToRootPosition, rootMotionMatrix, rootPositionToWorld } from './rootMotionCoordinates.js';

/** Editor-only square/diamond handle, independent of skeleton, IK and ground gesture owners. */
export class AnimationEditorRootHandle {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly unsubscribe: () => void;
  private drag: { id: number; matrix: Affine; offset: Point; moved: boolean } | undefined;
  private disposed = false;
  private interactive = true;
  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    if (!interactive) this.cancel();
  }
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: RootHandleState,
    private readonly puppet: Puppet,
    private readonly backgroundDrag?: (pointer: Phaser.Input.Pointer) => void,
  ) {
    this.graphics = scene.add.graphics().setDepth(puppet.container.depth + 6);
    scene.input.on('pointermove', this.move);
    scene.input.on('pointerup', this.up);
    scene.input.on('pointerupoutside', this.up);
    window.addEventListener?.('keydown', this.keydown, true);
    window.addEventListener?.('blur', this.cancel);
    window.addEventListener?.('pagehide', this.cancel);
    globalThis.document?.addEventListener?.('visibilitychange', this.visibility);
    this.unsubscribe = state.subscribe(() => {
      if (!state.rootMotion.rootMotionDragActive) this.drag = undefined;
    });
  }
  private matrix(): Affine {
    const matrix = this.puppet.container.getWorldTransformMatrix();
    const root = this.state.rootMotion.rootPosition;
    return rootMotionMatrix(matrix, {
      x: matrix.tx - matrix.a * root.x - matrix.c * root.y,
      y: matrix.ty - matrix.b * root.x - matrix.d * root.y,
    });
  }

  render(): void {
    if (this.disposed) return;
    const g = this.graphics;
    g.clear();
    const state = this.state;
    const animation = state.previewAnimation;
    if (
      !animation ||
      !state.animationAuthoringEnabled ||
      !state.rootMotion.rootMotionVisible ||
      !this.puppet.container.visible
    )
      return;
    const matrix = this.matrix();
    const zoom = this.scene.cameras.main.zoom;
    const world = (time: number) => rootPositionToWorld(sampleRootMotion(animation, time), matrix);
    if (state.rootMotion.rootTrajectoryVisible && animation.rootMotion?.translationKeys.length) {
      // Fixed-size sampling uses the existing evaluator, including property curves.
      let previous = world(0);
      for (let i = 1; i <= 128; i++) {
        const point = world((animation.duration * i) / 128);
        g.lineStyle(1.5 / zoom, 0xbf8bff, 0.65).lineBetween(previous.x, previous.y, point.x, point.y);
        previous = point;
      }
      for (const key of animation.rootMotion?.translationKeys ?? []) {
        const point = world(key.time);
        const selected = state.rootMotion.selectedRootKey?.time === key.time / 1000;
        g.fillStyle(selected ? 0xffffff : 0xbf8bff, 1).fillCircle(point.x, point.y, (selected ? 5 : 3) / zoom);
      }
    }
    if (!state.rootMotion.rootMotionEditing && !state.rootMotion.rootMotionSelected) return;
    const point = rootPositionToWorld(state.rootMotion.rootPosition, matrix);
    const r = 12 / zoom;
    g.fillStyle(0x191123, 0.9).fillRoundedRect(point.x - r, point.y - r, r * 2, r * 2, 0);
    g.lineStyle(4 / zoom, 0xffffff).strokeRect(point.x - r, point.y - r, r * 2, r * 2);
    g.lineStyle(2 / zoom, 0xbf8bff).strokeRect(point.x - r, point.y - r, r * 2, r * 2);
    g.lineBetween(point.x - r / 2, point.y, point.x, point.y - r / 2)
      .lineBetween(point.x, point.y - r / 2, point.x + r / 2, point.y)
      .lineBetween(point.x + r / 2, point.y, point.x, point.y + r / 2)
      .lineBetween(point.x, point.y + r / 2, point.x - r / 2, point.y);
  }
  pointerDown(pointer: Phaser.Input.Pointer): boolean {
    if (this.disposed || !this.state.rootMotion.rootMotionEditing || !this.state.animationAuthoringEnabled)
      return false;
    if (this.drag) return true;
    if (pointer.button !== 0) return false;
    // Root mode consumes left clicks before ground, contact, IK or bone picking.
    if (this.drag || !this.state.rootMotion.rootMotionVisible || !this.puppet.container.visible) return true;
    const matrix = this.matrix();
    const root = this.state.rootMotion.rootPosition;
    const point = rootPositionToWorld(root, matrix);
    const camera = this.scene.cameras.main;
    const world = camera.getWorldPoint(pointer.x, pointer.y);
    if (Math.hypot(point.x - world.x, point.y - world.y) * camera.zoom > 22) {
      this.backgroundDrag?.(pointer);
      return true;
    }
    if (!this.interactive) return true;
    const start = pointerToRootPosition(pointer, camera, matrix);
    if (!start || !this.state.rootMotion.beginRootMotionDrag()) return true;
    this.drag = { id: pointer.id, matrix, offset: { x: root.x - start.x, y: root.y - start.y }, moved: false };
    return true;
  }
  private move = (pointer: Phaser.Input.Pointer): void => {
    const drag = this.drag;
    if (!drag || pointer.id !== drag.id) return;
    const point = pointerToRootPosition(pointer, this.scene.cameras.main, drag.matrix);
    if (!point) {
      this.cancel();
      return;
    }
    const next = { x: point.x + drag.offset.x, y: point.y + drag.offset.y };
    if (
      !drag.moved &&
      Math.hypot(next.x - this.state.rootMotion.rootPosition.x, next.y - this.state.rootMotion.rootPosition.y) < 1e-8
    )
      return;
    drag.moved = true;
    this.state.rootMotion.previewRootMotionDrag(next);
  };
  private up = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.id !== this.drag?.id) return;
    this.move(pointer);
    this.drag = undefined;
    this.state.rootMotion.commitRootMotionDrag();
  };
  private cancel = (): void => {
    this.drag = undefined;
    this.state.rootMotion.cancelRootMotionDrag();
  };
  private visibility = (): void => {
    if (document.visibilityState === 'hidden') this.cancel();
  };
  private keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.drag || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    this.scene.input.off('pointermove', this.move);
    this.scene.input.off('pointerup', this.up);
    this.scene.input.off('pointerupoutside', this.up);
    window.removeEventListener?.('keydown', this.keydown, true);
    window.removeEventListener?.('blur', this.cancel);
    window.removeEventListener?.('pagehide', this.cancel);
    globalThis.document?.removeEventListener?.('visibilitychange', this.visibility);
    this.graphics.destroy();
  }
}
