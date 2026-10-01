import Phaser from 'phaser';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import type { Puppet } from '../../engine/Puppet.js';
import { RigEditorOverlay } from './RigEditorOverlay.js';
import { RigEditorState } from './RigEditorState.js';

export class RigEditor {
  readonly state: RigEditorState;
  private overlay: RigEditorOverlay | undefined;
  private panning = false;
  private moved = false;
  private downX = 0;
  private downY = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly onChange: () => void,
    state?: RigEditorState,
    private readonly ikChains: readonly TwoBoneIKDefinition[] = [],
  ) {
    this.state = state ?? new RigEditorState(puppet.rig);
  }

  enable(): void {
    if (this.overlay) return;
    this.puppet.resetToBindPose().setFacing('right');
    this.overlay = new RigEditorOverlay(this.scene, this.puppet, this.state, this.ikChains);
    this.scene.input.on('pointerdown', this.pointerDown, this);
    this.scene.input.on('pointermove', this.pointerMove, this);
    this.scene.input.on('pointerup', this.pointerUp, this);
    this.scene.input.on('wheel', this.wheel, this);
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.update();
  }

  disable(): void {
    if (!this.overlay) return;
    this.scene.input.off('pointerdown', this.pointerDown, this);
    this.scene.input.off('pointermove', this.pointerMove, this);
    this.scene.input.off('pointerup', this.pointerUp, this);
    this.scene.input.off('wheel', this.wheel, this);
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.overlay.destroy();
    this.overlay = undefined;
  }

  refresh(): void {
    for (const bone of this.state.rig.bones) {
      this.puppet.getBone(bone.id).sprite?.setAlpha(this.state.visibility.artwork ? this.state.artworkOpacity : 0);
    }
    for (const slot of this.state.rig.slots) {
      this.puppet.getSlotImage(slot.id)?.setAlpha(this.state.visibility.artwork ? this.state.artworkOpacity : 0);
    }
    this.update();
    this.onChange();
  }

  getAttachment(id: string): string | undefined {
    return this.puppet.getAttachment(id);
  }

  private update(): void {
    this.overlay?.draw();
  }

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    this.panning = pointer.middleButtonDown();
    this.moved = false;
    this.downX = pointer.x;
    this.downY = pointer.y;
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    if (!pointer.isDown) return;
    if (Math.hypot(pointer.x - this.downX, pointer.y - this.downY) > 4) this.moved = true;
    if (!this.panning) return;
    const camera = this.scene.cameras.main;
    camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
    camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
    this.update();
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.panning && !this.moved) {
      this.state.selection = this.overlay?.pick(pointer.x, pointer.y, pointer.event?.altKey ?? false) ?? null;
      this.onChange();
      this.update();
    }
    this.panning = false;
  }

  private wheel(pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number): void {
    const camera = this.scene.cameras.main;
    const oldZoom = camera.zoom;
    const nextZoom = Phaser.Math.Clamp(oldZoom * Math.exp(-dy * 0.001), 0.35, 4);
    camera.scrollX += (pointer.x - camera.width / 2) * (1 / oldZoom - 1 / nextZoom);
    camera.scrollY += (pointer.y - camera.height / 2) * (1 / oldZoom - 1 / nextZoom);
    camera.setZoom(nextZoom);
    this.update();
  }
}
