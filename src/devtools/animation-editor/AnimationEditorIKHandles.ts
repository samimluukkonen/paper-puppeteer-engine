import type Phaser from 'phaser';
import { localToWorld, worldToLocal, type Point } from '../../engine/affineMath.js';
import { IK_EPSILON } from '../../engine/ik/solveTwoBoneIK.js';
import type { Puppet } from '../../engine/Puppet.js';
import { panCamera, zoomCameraAt } from '../shared/editorCamera.js';
import type { GroundGuide } from '../shared/groundGuide.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { evaluateIKTarget } from './ikInspectorSampling.js';
import { ikTargetToWorld, pointerToIKTarget, snapIKTargetToGuide } from './ikTargetCoordinates.js';

export interface IKTargetHandle {
  readonly id: string;
  readonly world: Point;
  readonly endpoint: Point;
  readonly disabledReason: string | null;
}

/** One editor-only graphics object and one input owner per preview session. */
export class AnimationEditorIKHandles {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly unsubscribe: () => void;
  private visible = true;
  private interactive = true;
  private pointerId: number | undefined;
  private offset: Point | undefined;
  private pan: Point | undefined;
  private characterDrag: { start: Point; origin: Readonly<Point>; session: number; moved: boolean } | undefined;
  private disposed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: AnimationEditorState,
    private readonly puppet: Puppet,
    private readonly ground?: { guide: () => GroundGuide; dragging: () => boolean },
  ) {
    this.graphics = scene.add.graphics().setDepth(puppet.container.depth + 4);
    scene.input.on('pointermove', this.pointerMove);
    scene.input.on('pointerup', this.pointerUp);
    scene.input.on('pointerupoutside', this.pointerUp);
    scene.input.on('wheel', this.wheel);
    window.addEventListener?.('keydown', this.keyDown, true);
    window.addEventListener?.('blur', this.cancel);
    window.addEventListener?.('pagehide', this.cancel);
    window.addEventListener?.('visibilitychange', this.visibilityChanged, true);
    this.unsubscribe = state.subscribe(() => {
      if (this.offset && !state.ikTargetDrag) this.release();
      if (
        this.characterDrag &&
        (!state.animationAuthoringEnabled || state.sessionRevision !== this.characterDrag.session)
      )
        this.release();
    });
    this.refreshAvailability();
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.visible = visible;
    if (!visible) this.cancel();
    this.graphics.setVisible(visible);
  }
  setInteractive(interactive: boolean): void {
    if (this.disposed) return;
    this.interactive = interactive;
    if (!interactive) this.cancel();
  }

  refreshAvailability(): void {
    if (this.disposed) return;
    const matrix = this.puppet.container.getWorldTransformMatrix();
    for (const definition of this.puppet.rig.ik ?? []) {
      const constraint = this.puppet.getIK(definition.name);
      const root = this.puppet.getBone(constraint.rootBone);
      const sx = Math.abs(root.pose.scaleX);
      const sy = Math.abs(root.pose.scaleY);
      // Inspect current transforms: a held solver status can outlive a host scale edit.
      const singularChain =
        sx <= IK_EPSILON ||
        sy <= IK_EPSILON ||
        !worldToLocal({ x: 0, y: 0 }, root.container.parentContainer.getWorldTransformMatrix());
      const reason =
        constraint.targetOwnership === 'provider'
          ? 'A target provider owns this constraint (fixed preview or weapon grip). Disable that owner to drag.'
          : constraint.targetOwnership === 'runtime'
            ? 'A runtime world target owns this constraint (for example foot planting). Release that owner to drag.'
            : !constraint.enabled
              ? 'This IK constraint is disabled.'
              : !worldToLocal({ x: matrix.tx, y: matrix.ty }, matrix)
                ? 'The puppet transform is singular. Restore a nonzero scale to drag.'
                : singularChain
                  ? 'The IK chain transform is singular. Restore nonzero chain and parent scales to drag.'
                  : Math.abs(sx - sy) > IK_EPSILON * Math.max(sx, sy)
                    ? 'This solver does not support nonuniform scale inside the IK chain. Use uniform root scale.'
                    : null;
      this.state.setIKManipulationDisabledReason(definition.name, reason);
    }
  }

  getHandles(): readonly IKTargetHandle[] {
    if (this.disposed) return [];
    this.refreshAvailability();
    const animation = this.state.workingAnimation;
    if (!animation) return [];
    const matrix = this.puppet.container.getWorldTransformMatrix();
    return (this.puppet.rig.ik ?? []).flatMap((definition) => {
      const constraint = this.puppet.getIK(definition.name);
      const sampled = evaluateIKTarget(animation, this.puppet.rig, definition.name, this.state.currentTimeMilliseconds);
      if (!sampled) return [];
      const selected = this.state.selectedIKConstraintId === definition.name;
      const target = selected ? { ...sampled, ...this.state.ikTargetDraft } : sampled;
      const endpoint = localToWorld(
        constraint.endOffset,
        this.puppet.getBone(constraint.endBone).container.getWorldTransformMatrix(),
      );
      // The requested position survives zero influence and unreachable solver clamping.
      const world =
        constraint.targetOwnership === 'animation'
          ? ikTargetToWorld(target, matrix)
          : (constraint.resolvedTarget ?? constraint.target ?? endpoint);
      return [
        {
          id: definition.name,
          world,
          endpoint,
          disabledReason: this.state.getIKManipulationDisabledReason(definition.name),
        },
      ];
    });
  }

  render(): void {
    if (this.disposed) return;
    const graphics = this.graphics;
    graphics.setDepth(this.puppet.container.depth + 4);
    graphics.clear();
    if (!this.visible || !this.puppet.container.visible) return;
    const zoom = this.scene.cameras.main.zoom;
    // Draw the selection last so nearby targets cannot cover its highlight.
    const handles = [...this.getHandles()].sort(
      (a, b) => Number(a.id === this.state.selectedIKConstraintId) - Number(b.id === this.state.selectedIKConstraintId),
    );
    for (const handle of handles) {
      const selected = this.state.selectedIKConstraintId === handle.id;
      const color = handle.disabledReason || !this.interactive ? 0x8b929a : selected ? 0xe7a52b : 0x249fa8;
      const radius = (selected ? 14 : 11) / zoom;
      const extent = radius + 5 / zoom;
      const { x, y } = handle.world;
      graphics.lineStyle(1 / zoom, color, 0.5).lineBetween(x, y, handle.endpoint.x, handle.endpoint.y);
      if (selected) graphics.fillStyle(color, 0.2).fillCircle(x, y, radius + 2 / zoom);
      // Dark and white outlines keep the colored crosshair legible on light and dark artwork.
      for (const stroke of [
        { width: selected ? 9 : 8, color: 0x182a31 },
        { width: selected ? 7 : 6, color: 0xffffff },
        { width: selected ? 4 : 3, color },
      ]) {
        graphics.lineStyle(stroke.width / zoom, stroke.color, 1).strokeCircle(x, y, radius);
        graphics.lineBetween(x - extent, y, x + extent, y);
        graphics.lineBetween(x, y - extent, x, y + extent);
      }
      graphics.lineStyle(1 / zoom, color, 0.7).strokeCircle(handle.endpoint.x, handle.endpoint.y, 2 / zoom);
    }
  }

  /** Called before bone picking. Even a disabled handle consumes the click and selects its constraint. */
  get gestureActive(): boolean {
    return this.pointerId !== undefined;
  }

  pointerDown(pointer: Phaser.Input.Pointer): boolean {
    if (this.disposed) return false;
    if (this.pointerId !== undefined) return true;
    if (pointer.button === 1) {
      this.startPan(pointer);
      return true;
    }
    if (!this.visible || !this.puppet.container.visible || pointer.button !== 0) return false;
    const camera = this.scene.cameras.main;
    const world = camera.getWorldPoint(pointer.x, pointer.y);
    const handles = [...this.getHandles()].sort(
      (a, b) => Number(b.id === this.state.selectedIKConstraintId) - Number(a.id === this.state.selectedIKConstraintId),
    );
    const handle = handles.find((entry) => {
      const hitRadius = entry.id === this.state.selectedIKConstraintId ? 25 : 22;
      return Math.hypot(entry.world.x - world.x, entry.world.y - world.y) * camera.zoom <= hitRadius;
    });
    if (!handle) return false;
    if (!this.interactive || handle.disabledReason) {
      if (this.state.selectedIKConstraintId !== handle.id) this.state.selectIKConstraint(handle.id);
      return true;
    }
    const matrix = this.puppet.container.getWorldTransformMatrix();
    const start = pointerToIKTarget(pointer, camera, matrix);
    const target = worldToLocal(handle.world, matrix);
    if (!start || !target || !this.state.beginIKTargetDrag(handle.id)) return true;
    this.pointerId = pointer.id;
    this.offset = { x: target.x - start.x, y: target.y - start.y };
    return true;
  }

  /** Left background drag changes only preview placement; middle drag remains camera navigation. */
  startCharacterDrag(pointer: Phaser.Input.Pointer): void {
    if (
      this.disposed ||
      this.pointerId !== undefined ||
      !this.state.animationAuthoringEnabled ||
      !this.puppet.container.visible
    )
      return;
    this.pointerId = pointer.id;
    this.characterDrag = {
      start: { x: pointer.x, y: pointer.y },
      origin: this.state.previewPlacementOffset,
      session: this.state.sessionRevision,
      moved: false,
    };
  }

  /** Middle-button camera navigation shares the pointer gesture lifetime with preview placement. */
  startPan(pointer: Phaser.Input.Pointer): void {
    if (this.disposed || this.pointerId !== undefined) return;
    this.pointerId = pointer.id;
    this.pan = { x: pointer.x, y: pointer.y };
  }

  private pointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.id !== this.pointerId) return;
    if (this.characterDrag) {
      const { start, origin } = this.characterDrag;
      const dx = pointer.x - start.x;
      const dy = pointer.y - start.y;
      if (!this.characterDrag.moved && Math.hypot(dx, dy) <= 4) return;
      this.characterDrag.moved = true;
      const zoom = this.scene.cameras.main.zoom;
      this.state.setPreviewPlacementOffset(origin.x + dx / zoom, origin.y + dy / zoom);
      return;
    }
    if (this.pan) {
      panCamera(this.scene.cameras.main, pointer.x - this.pan.x, pointer.y - this.pan.y);
      this.pan = { x: pointer.x, y: pointer.y };
      return;
    }
    this.refreshAvailability();
    if (!this.offset || !this.state.ikTargetDrag) return;
    const target = pointerToIKTarget(pointer, this.scene.cameras.main, this.puppet.container.getWorldTransformMatrix());
    if (!target) {
      this.cancel();
      return;
    }
    const draft = { x: target.x + this.offset.x, y: target.y + this.offset.y };
    this.state.previewIKTargetDrag(
      this.ground
        ? snapIKTargetToGuide(
            draft,
            this.puppet.container.getWorldTransformMatrix(),
            this.ground.guide(),
            this.scene.cameras.main.zoom,
          )
        : draft,
    );
  };
  private pointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.id !== this.pointerId) return;
    if (this.offset) {
      this.pointerMove(pointer);
      this.state.endIKTargetDrag();
    }
    this.release();
  };
  private wheel = (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number): void => {
    if (this.pointerId !== undefined || this.ground?.dragging()) return;
    zoomCameraAt(this.scene.cameras.main, pointer.x, pointer.y, dy);
  };
  private release(): void {
    this.pointerId = undefined;
    this.offset = undefined;
    this.pan = undefined;
    this.characterDrag = undefined;
  }
  private cancel = (): void => {
    this.state.cancelIKTargetDrag();
    this.release();
  };
  private visibilityChanged = (): void => {
    if (document.visibilityState === 'hidden') this.cancel();
  };
  private keyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || this.pointerId === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    this.scene.input.off('pointermove', this.pointerMove);
    this.scene.input.off('pointerup', this.pointerUp);
    this.scene.input.off('pointerupoutside', this.pointerUp);
    this.scene.input.off('wheel', this.wheel);
    window.removeEventListener?.('keydown', this.keyDown, true);
    window.removeEventListener?.('blur', this.cancel);
    window.removeEventListener?.('pagehide', this.cancel);
    window.removeEventListener?.('visibilitychange', this.visibilityChanged, true);
    this.graphics.destroy();
  }
}
