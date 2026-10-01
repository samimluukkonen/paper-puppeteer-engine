import type Phaser from 'phaser';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import type { Puppet } from '../../engine/Puppet.js';
import { gridLines } from './grid.js';
import type { RigEditorSelection, RigEditorState } from './RigEditorState.js';

type Point = { x: number; y: number };
const distanceToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/** Screen-space drawing and picking keep handles usable at every camera zoom. */
export class RigEditorOverlay {
  private readonly gridGraphics: Phaser.GameObjects.Graphics;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private gridSignature = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly state: RigEditorState,
    private readonly ikChains: readonly TwoBoneIKDefinition[],
  ) {
    this.gridGraphics = scene.add.graphics().setScrollFactor(0).setDepth(-10000);
    this.graphics = scene.add.graphics().setScrollFactor(0).setDepth(10000);
  }

  private gridFrame(): Phaser.GameObjects.Container {
    const selected = this.state.selection;
    if (!selected) return this.puppet.container;
    if (selected.type === 'slot') {
      if (this.state.editMode === 'sprite') {
        const mount = this.puppet.getSlotImage(selected.id)?.parentContainer;
        if (mount) return mount;
      }
      return this.puppet.getBone(this.state.getSlot(selected.id).bone).container;
    }
    const bone = this.puppet.getBone(selected.id).container;
    return this.state.editMode === 'sprite' ? bone : (bone.parentContainer ?? this.puppet.container);
  }

  private drawGrid(originX: number, originY: number, zoom: number): void {
    const g = this.gridGraphics;
    if (!this.state.gridSnap) {
      if (this.gridSignature !== 'off') g.clear();
      this.gridSignature = 'off';
      return;
    }
    const matrix = this.gridFrame().getWorldTransformMatrix();
    const origin = this.screen(matrix.transformPoint(0, 0));
    const x = this.screen(matrix.transformPoint(1, 0));
    const y = this.screen(matrix.transformPoint(0, 1));
    const camera = this.scene.cameras.main;
    const transform = {
      a: x.x - origin.x,
      b: x.y - origin.y,
      c: y.x - origin.x,
      d: y.y - origin.y,
      tx: origin.x,
      ty: origin.y,
    };
    const signature = [
      this.state.gridSnap,
      camera.width,
      camera.height,
      originX,
      originY,
      zoom,
      ...Object.values(transform),
    ].join(',');
    if (signature === this.gridSignature) return;
    this.gridSignature = signature;
    g.clear();
    g.setPosition(originX, originY).setScale(1 / zoom);
    const snapPixels =
      Math.min(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d)) * this.state.gridSnap;
    const minorAlpha = snapPixels < 2 ? 0.09 : snapPixels < 4 ? 0.14 : snapPixels < 8 ? 0.2 : 0.26;
    for (const line of gridLines(transform, camera.width, camera.height, this.state.gridSnap)) {
      const alpha = line.index === 0 ? 0.6 : line.index % 5 === 0 ? 0.45 : minorAlpha;
      g.lineStyle(line.index === 0 ? 1.5 : 1, 0x719587, alpha).lineBetween(
        line.start.x,
        line.start.y,
        line.end.x,
        line.end.y,
      );
    }
  }

  private screen(point: Point): Point {
    const camera = this.scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (point.x - topLeft.x) * camera.zoom, y: (point.y - topLeft.y) * camera.zoom };
  }

  private bonePoint(id: string): Point {
    return this.screen(this.puppet.getBone(id).getWorldPosition());
  }

  private slotPoint(id: string): Point {
    const slot = this.state.getSlot(id);
    const matrix = this.puppet.getBone(slot.bone).container.getWorldTransformMatrix();
    return this.screen(matrix.transformPoint(slot.x ?? 0, slot.y ?? 0));
  }

  /** Closest visible marker wins; exact ties use rig order, with joints before slots. */
  pick(x: number, y: number, preferSlots = false): RigEditorSelection {
    const pointer = { x, y };
    const candidates: { selection: NonNullable<RigEditorSelection>; distance: number; order: number }[] = [];
    const add = (selection: NonNullable<RigEditorSelection>, distance: number, order: number): void => {
      if (distance <= 13) candidates.push({ selection, distance, order });
    };
    if (this.state.visibility.bones) {
      this.state.rig.bones.forEach((bone, index) => {
        const point = this.bonePoint(bone.id);
        add({ type: 'bone', id: bone.id }, Math.hypot(x - point.x, y - point.y), index);
        if (bone.parent) {
          add({ type: 'bone', id: bone.id }, distanceToSegment(pointer, point, this.bonePoint(bone.parent)) + 4, index);
        }
      });
    }
    if (this.state.visibility.slots) {
      this.state.rig.slots.forEach((slot, index) => {
        const point = this.slotPoint(slot.id);
        add({ type: 'slot', id: slot.id }, Math.hypot(x - point.x, y - point.y), 1000 + index);
      });
    }
    candidates.sort((a, b) => {
      if (preferSlots && a.selection.type !== b.selection.type) return a.selection.type === 'slot' ? -1 : 1;
      return a.distance - b.distance || a.order - b.order;
    });
    return candidates[0]?.selection ?? null;
  }

  draw(): void {
    const g = this.graphics;
    const camera = this.scene.cameras.main;
    const zoom = camera.zoom;
    const originX = camera.width * 0.5 * (1 - 1 / zoom);
    const originY = camera.height * 0.5 * (1 - 1 / zoom);
    // Phaser still applies camera zoom to scroll-factor-zero objects.
    g.setPosition(originX, originY).setScale(1 / zoom);
    g.clear();
    this.drawGrid(originX, originY, zoom);
    let labelIndex = 0;
    const label = (text: string, x: number, y: number, color: string): void => {
      let item = this.labels[labelIndex];
      if (!item) {
        item = this.scene.add
          .text(0, 0, '', {
            fontFamily: 'monospace',
            fontSize: '11px',
            backgroundColor: '#f7f3e9d9',
            padding: { x: 2, y: 1 },
          })
          .setScrollFactor(0)
          .setDepth(10001);
        this.labels.push(item);
      }
      item
        .setText(text)
        .setColor(color)
        .setPosition(x / zoom + originX, y / zoom + originY)
        .setScale(1 / zoom)
        .setVisible(true);
      labelIndex += 1;
    };
    if (this.state.gridSnap) label(`Grid ${this.state.gridSnap} · local`, 16, 16, '#426f5e');
    if (this.state.visibility.bones) {
      for (const bone of this.state.rig.bones) {
        const p = this.bonePoint(bone.id);
        const selected = this.state.selection?.type === 'bone' && this.state.selection.id === bone.id;
        const color = selected ? 0xe45f35 : 0x217c87;
        if (bone.parent) {
          const parent = this.bonePoint(bone.parent);
          g.lineStyle(selected ? 4 : 2, color, 0.92).lineBetween(parent.x, parent.y, p.x, p.y);
        }
        g.fillStyle(0xf8f5e8).fillCircle(p.x, p.y, selected ? 8 : 6);
        g.lineStyle(selected ? 3 : 2, color).strokeCircle(p.x, p.y, selected ? 8 : 6);
        if (this.state.visibility.boneNames || selected)
          label(bone.id, p.x + 9, p.y - 18, selected ? '#a53d21' : '#155c65');
        const edited = this.state.getBone(bone.id);
        if (this.state.visibility.boneLengths && edited.length !== undefined) {
          const matrix = this.puppet.getBone(bone.id).container.getWorldTransformMatrix();
          const end = this.screen(matrix.transformPoint(0, edited.length));
          g.lineStyle(2, 0xdb9e32, 0.9).lineBetween(p.x, p.y, end.x, end.y).strokeCircle(end.x, end.y, 3);
        }
      }
    }
    if (this.state.visibility.slots) {
      for (const slot of this.state.rig.slots) {
        const p = this.slotPoint(slot.id);
        const selected = this.state.selection?.type === 'slot' && this.state.selection.id === slot.id;
        g.lineStyle(selected ? 3 : 2, selected ? 0xe45f35 : 0x713aa0);
        g.strokeRect(p.x - 5, p.y - 5, 10, 10);
        if (selected)
          label(
            `${slot.id} · ${slot.bone} → ${this.puppet.getAttachment(slot.id) ?? 'empty'}`,
            p.x + 10,
            p.y + 7,
            '#a53d21',
          );
      }
    }
    if (this.state.visibility.spriteOrigins || this.state.editMode === 'sprite') {
      const mark = (point: Point, selected: boolean): void => {
        const p = this.screen(point);
        g.lineStyle(selected ? 3 : 2, selected ? 0xe45f35 : 0xbd682c)
          .lineBetween(p.x - 5, p.y, p.x + 5, p.y)
          .lineBetween(p.x, p.y - 5, p.x, p.y + 5);
      };
      for (const bone of this.state.rig.bones) {
        const image = this.puppet.getBone(bone.id).sprite;
        const selected = this.state.selection?.type === 'bone' && this.state.selection.id === bone.id;
        if (image && (this.state.visibility.spriteOrigins || selected)) {
          const matrix = image.getWorldTransformMatrix();
          mark({ x: matrix.tx, y: matrix.ty }, selected);
        }
      }
      for (const slot of this.state.rig.slots) {
        const image = this.puppet.getSlotImage(slot.id);
        const selected = this.state.selection?.type === 'slot' && this.state.selection.id === slot.id;
        if (image && (this.state.visibility.spriteOrigins || selected)) {
          const matrix = image.getWorldTransformMatrix();
          mark({ x: matrix.tx, y: matrix.ty }, selected);
        }
      }
    }
    if (this.state.visibility.ik) {
      for (const [index, chain] of this.ikChains.entries()) {
        const root = this.bonePoint(chain.rootBone);
        const middle = this.bonePoint(chain.middleBone);
        const end = this.bonePoint(chain.endBone);
        const color = [0xb78d22, 0xa257ae, 0x3e91b2, 0xc87855][index % 4]!;
        g.lineStyle(3, color, 0.7)
          .lineBetween(root.x, root.y, middle.x, middle.y)
          .lineBetween(middle.x, middle.y, end.x, end.y);
        g.strokeCircle(end.x, end.y, 9);
        label(chain.name, end.x + 12, end.y - 10, '#76562b');
      }
      label(
        this.state.ikPreview ? 'IK preview · fixed targets' : 'IK chains · solver off',
        16,
        this.state.gridSnap ? 34 : 16,
        '#7b642b',
      );
    }
    for (let i = labelIndex; i < this.labels.length; i += 1) this.labels[i]?.setVisible(false);
  }

  destroy(): void {
    this.gridGraphics.destroy();
    this.graphics.destroy();
    for (const label of this.labels) label.destroy();
  }
}
