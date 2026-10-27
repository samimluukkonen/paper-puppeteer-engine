import type Phaser from 'phaser';
import { localToWorld, worldToLocal } from '../../engine/affineMath.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import { meshEdges } from '../../engine/meshEditing.js';
import type { Puppet } from '../../engine/Puppet.js';
import { gridLines } from './grid.js';
import type { RigEditorSelection, RigEditorState } from './RigEditorState.js';
import { rigIKBendArrow } from './rigIKBendArrow.js';
import { rigIKFeedback } from './rigIKFeedback.js';

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
  private disposed = false;
  private gridSignature = '';
  private drawSnapshot: readonly unknown[] | undefined;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly state: RigEditorState,
    private readonly ikChains: readonly TwoBoneIKDefinition[],
    private readonly ownsPreviewTarget: (id: string) => boolean = () => false,
  ) {
    this.gridGraphics = scene.add.graphics().setScrollFactor(0).setDepth(-10000);
    this.graphics = scene.add.graphics().setScrollFactor(0).setDepth(10000);
  }

  private get chains(): readonly TwoBoneIKDefinition[] {
    const authored = this.state.workingCopy.ik ?? [];
    return [...authored, ...this.ikChains.filter((chain) => !authored.some((entry) => entry.name === chain.name))];
  }

  /** Requested rig targets stay visible even when the solver clamps or a runtime owner overrides them. */
  getIKTargets() {
    if (this.disposed) return [];
    const matrix = this.puppet.container.getWorldTransformMatrix();
    return (this.state.workingCopy.ik ?? []).flatMap((definition) => {
      const constraint = this.puppet.getIK(definition.name);
      const endpoint = localToWorld(
        definition.endOffset ?? { x: 0, y: 0 },
        this.puppet.getBone(definition.endBone).container.getWorldTransformMatrix(),
      );
      const target = definition.target ?? worldToLocal(endpoint, matrix);
      if (!target) return [];
      const disabledReason =
        constraint.targetOwnership === 'provider' ||
        (constraint.targetOwnership === 'runtime' && !this.ownsPreviewTarget(definition.name))
          ? 'A runtime target or provider owns this constraint. Release that owner before dragging.'
          : !worldToLocal(endpoint, matrix)
            ? 'The puppet transform is singular.'
            : null;
      return [
        {
          id: definition.name,
          target,
          world: localToWorld(target, matrix),
          endpoint,
          enabled: definition.enabled !== false,
          feedback: rigIKFeedback(constraint, definition),
          disabledReason,
        },
      ];
    });
  }

  pickIKTarget(x: number, y: number) {
    return this.getIKTargets()
      .filter((handle) => this.state.visibility.ik || this.state.selectedIKConstraintId === handle.id)
      .map((handle) => ({
        ...handle,
        distance: Math.hypot(x - this.screen(handle.world).x, y - this.screen(handle.world).y),
      }))
      .filter((handle) => handle.distance <= 20)
      .sort(
        (a, b) =>
          Number(b.id === this.state.selectedIKConstraintId) - Number(a.id === this.state.selectedIKConstraintId) ||
          a.distance - b.distance,
      )[0];
  }

  /** Positions come from the live bone container, including nested transforms and facing. */
  getFootContactMarkers() {
    if (this.disposed) return [];
    return (this.state.workingCopy.footContactMarkers ?? []).flatMap((marker) => {
      const world = localToWorld(
        { x: marker.localX, y: marker.localY },
        this.puppet.getBone(marker.boneId).container.getWorldTransformMatrix(),
      );
      return Number.isFinite(world.x) && Number.isFinite(world.y) ? [{ ...marker, world }] : [];
    });
  }

  pickFootContactMarker(x: number, y: number) {
    return this.getFootContactMarkers()
      .filter((marker) => this.state.visibility.footContacts || marker.id === this.state.selectedFootContactMarkerId)
      .map((marker) => ({
        ...marker,
        distance: Math.hypot(x - this.screen(marker.world).x, y - this.screen(marker.world).y),
      }))
      .filter((marker) => marker.distance <= 11)
      .sort(
        (a, b) =>
          Number(b.id === this.state.selectedFootContactMarkerId) -
            Number(a.id === this.state.selectedFootContactMarkerId) || a.distance - b.distance,
      )[0];
  }

  getMeshVertices() {
    const mesh = this.state.selectedMesh;
    const slot = this.state.selection;
    if (this.disposed || this.state.editMode !== 'mesh' || !mesh || slot?.type !== 'slot') return [];
    const object = this.puppet.getSlotMesh(slot.id);
    if (!object) return [];
    const matrix = object.getWorldTransformMatrix();
    return mesh.vertices.map((vertex, index) => ({
      ...vertex,
      index,
      screen: this.screen(localToWorld(vertex, matrix)),
    }));
  }

  pickMeshVertex(x: number, y: number) {
    return this.getMeshVertices()
      .map((vertex) => ({ ...vertex, distance: Math.hypot(x - vertex.screen.x, y - vertex.screen.y) }))
      .filter((vertex) => vertex.distance <= 11)
      .sort((a, b) => a.distance - b.distance)[0];
  }

  pickMeshEdge(x: number, y: number): [number, number] | undefined {
    const mesh = this.state.selectedMesh;
    const points = this.getMeshVertices();
    if (!mesh || !points.length) return undefined;
    return meshEdges(mesh)
      .map((edge) => ({
        edge,
        distance: distanceToSegment({ x, y }, points[edge[0]]!.screen, points[edge[1]]!.screen),
      }))
      .filter((edge) => edge.distance <= 8)
      .sort((a, b) => a.distance - b.distance)[0]?.edge;
  }

  private gridFrame(): Phaser.GameObjects.Container | Phaser.GameObjects.Mesh2D {
    const marker = this.state.selectedFootContactMarkerId;
    if (marker) return this.puppet.getBone(this.state.getFootContactMarker(marker).boneId).container;
    const selected = this.state.selection;
    if (!selected) return this.puppet.container;
    if (selected.type === 'slot') {
      if (this.state.editMode === 'mesh') {
        const mesh = this.puppet.getSlotMesh(selected.id);
        if (mesh) return mesh;
      }
      if (this.state.editMode === 'sprite' || this.state.editMode === 'origin') {
        const mount = this.puppet.getSlotImage(selected.id)?.parentContainer;
        if (mount) return mount;
      }
      return this.puppet.getBone(this.state.getSlot(selected.id).bone).container;
    }
    const bone = this.puppet.getBone(selected.id).container;
    return this.state.editMode === 'sprite' || this.state.editMode === 'origin'
      ? bone
      : (bone.parentContainer ?? this.puppet.container);
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

  pickArtworkPivot(x: number, y: number): RigEditorSelection {
    const selected = this.state.selection;
    const image =
      selected?.type === 'bone'
        ? this.puppet.getBone(selected.id).sprite
        : selected
          ? this.puppet.getSlotImage(selected.id)
          : undefined;
    if (!image) return null;
    const matrix = image.getWorldTransformMatrix();
    const pivot = this.screen({ x: matrix.tx, y: matrix.ty });
    return Math.hypot(x - pivot.x, y - pivot.y) <= 13 ? selected : null;
  }

  /** Preview transforms/artwork can change without changing the authored working copy. */
  invalidate(): void {
    this.drawSnapshot = undefined;
  }

  draw(): void {
    if (this.disposed) return;
    const g = this.graphics;
    const camera = this.scene.cameras.main;
    const world = this.puppet.container.getWorldTransformMatrix();
    const view = camera.matrixCombined;
    const handles = this.getIKTargets();
    const visibleChains = this.chains.filter(
      (chain) => this.state.visibility.ik || chain.name === this.state.selectedIKConstraintId,
    );
    const snapshot = [
      this.state.workingCopy,
      this.state.selection?.type,
      this.state.selection?.id,
      this.state.selectedMeshVertexId,
      this.state.selectedMeshEdge,
      ...this.getMeshVertices().flatMap((vertex) => [vertex.screen.x, vertex.screen.y]),
      this.state.selectedIKConstraintId,
      ...visibleChains.flatMap((chain) =>
        [chain.rootBone, chain.middleBone, chain.endBone].flatMap((id) => {
          const matrix = this.puppet.getBone(id).container.getWorldTransformMatrix();
          return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty];
        }),
      ),
      ...handles.flatMap((handle) => [
        handle.world.x,
        handle.world.y,
        handle.endpoint.x,
        handle.endpoint.y,
        handle.disabledReason,
        handle.feedback.label,
      ]),
      this.state.selectedFootContactMarkerId,
      // Markers follow evaluated bone poses even when only the host preview advances.
      ...this.getFootContactMarkers().flatMap((marker) => [marker.world.x, marker.world.y]),
      this.state.editMode,
      this.state.gridSnap,
      this.state.ikPreview,
      ...Object.values(this.state.visibility),
      camera.x,
      camera.y,
      camera.width,
      camera.height,
      camera.scrollX,
      camera.scrollY,
      camera.zoom,
      camera.originX,
      camera.originY,
      // Camera matrices refresh during preRender, after scroll/zoom setters.
      view.a,
      view.b,
      view.c,
      view.d,
      view.tx,
      view.ty,
      world.a,
      world.b,
      world.c,
      world.d,
      world.tx,
      world.ty,
    ];
    if (this.drawSnapshot && snapshot.every((value, index) => value === this.drawSnapshot![index])) return;
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
    if (this.state.visibility.spriteOrigins || this.state.editMode === 'sprite' || this.state.editMode === 'origin') {
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
    if (this.state.editMode === 'sprite' || this.state.editMode === 'origin') {
      const selected = this.state.selection;
      if (selected) {
        const id = selected.type === 'bone' ? selected.id : this.state.getSlot(selected.id).bone;
        const joint = this.bonePoint(id);
        // Always show the selected joint reference, even when neighboring bones are hidden.
        g.lineStyle(2, 0x217c87).strokeCircle(joint.x, joint.y, 9);
        label('Joint reference', joint.x + 12, joint.y - 22, '#155c65');
        const image = selected.type === 'bone' ? this.puppet.getBone(id).sprite : this.puppet.getSlotImage(selected.id);
        if (image) {
          const matrix = image.getWorldTransformMatrix();
          const corners = [
            [-image.width * image.originX, -image.height * image.originY],
            [image.width * (1 - image.originX), -image.height * image.originY],
            [image.width * (1 - image.originX), image.height * (1 - image.originY)],
            [-image.width * image.originX, image.height * (1 - image.originY)],
          ].map(([x, y]) => this.screen(matrix.transformPoint(x!, y!)));
          for (let i = 0; i < 4; i++) {
            const a = corners[i]!,
              b = corners[(i + 1) % 4]!;
            g.lineStyle(1, 0xbd682c, 0.8).lineBetween(a.x, a.y, b.x, b.y);
          }
          const pivot = this.screen({ x: matrix.tx, y: matrix.ty });
          g.lineStyle(1, 0xbd682c, 0.7).lineBetween(joint.x, joint.y, pivot.x, pivot.y);
          label('Sprite pivot', pivot.x + 12, pivot.y + 8, '#a53d21');
        }
      }
    }
    if (this.state.visibility.ik || this.state.selectedIKConstraintId) {
      for (const [index, chain] of [...this.chains]
        .sort(
          (a, b) =>
            Number(a.name === this.state.selectedIKConstraintId) - Number(b.name === this.state.selectedIKConstraintId),
        )
        .entries()) {
        const selected = chain.name === this.state.selectedIKConstraintId;
        if (!this.state.visibility.ik && !selected) continue;
        const root = this.bonePoint(chain.rootBone);
        const middle = this.bonePoint(chain.middleBone);
        const end = this.bonePoint(chain.endBone);
        const color = selected
          ? 0xe45f35
          : chain.enabled === false
            ? 0x8b929a
            : [0xb78d22, 0xa257ae, 0x3e91b2, 0xc87855][index % 4]!;
        g.lineStyle(3, color, 0.7)
          .lineBetween(root.x, root.y, middle.x, middle.y)
          .lineBetween(middle.x, middle.y, end.x, end.y);
        for (const point of [root, middle, end]) g.strokeCircle(point.x, point.y, selected ? 10 : 9);
        if (selected) {
          label(`Start: ${chain.rootBone}`, root.x + 12, root.y - 22, '#a53d21');
          label(`Middle: ${chain.middleBone}`, middle.x + 26, middle.y - 22, '#a53d21');
          label(`${chain.name} · End: ${chain.endBone}`, end.x + 12, end.y - 10, '#a53d21');
          const bend = chain.bendDirection ?? 1;
          const basis = this.puppet.getBone(chain.rootBone).container.getWorldTransformMatrix();
          const arrow = rigIKBendArrow(middle, this.puppet.getBone(chain.middleBone).pose, bend, basis);
          g.lineStyle(2, color, 0.95);
          for (const points of [arrow.arc, arrow.head]) {
            for (let i = 1; i < points.length; i += 1)
              g.lineBetween(points[i - 1]!.x, points[i - 1]!.y, points[i]!.x, points[i]!.y);
          }
          label(
            `Bend ${bend === 1 ? '+1 · clockwise' : '−1 · counterclockwise'}`,
            middle.x + 26,
            middle.y + 8,
            '#a53d21',
          );
        } else label(chain.name, end.x + 12, end.y - 10, '#76562b');
      }
      for (const handle of handles.sort(
        (a, b) =>
          Number(a.id === this.state.selectedIKConstraintId) - Number(b.id === this.state.selectedIKConstraintId),
      )) {
        const selected = handle.id === this.state.selectedIKConstraintId;
        if (!this.state.visibility.ik && !selected) continue;
        const point = this.screen(handle.world);
        const end = this.screen(handle.endpoint);
        const color = !handle.enabled || handle.disabledReason ? 0x8b929a : selected ? 0xe45f35 : 0x249fa8;
        g.lineStyle(1, color, 0.6).lineBetween(point.x, point.y, end.x, end.y);
        for (const stroke of [
          { width: 6, color: 0xffffff },
          { width: selected ? 3 : 2, color },
        ]) {
          g.lineStyle(stroke.width, stroke.color)
            .strokeCircle(point.x, point.y, selected ? 12 : 10)
            .lineBetween(point.x - 16, point.y, point.x + 16, point.y)
            .lineBetween(point.x, point.y - 16, point.x, point.y + 16);
        }
        label(`${handle.id} · ${handle.feedback.label}`, point.x + 18, point.y + 10, '#76562b');
      }
      label(
        this.state.ikPreview ? 'IK preview · fixed targets' : 'IK chains · solver off',
        16,
        this.state.gridSnap ? 34 : 16,
        '#7b642b',
      );
    }
    for (const marker of this.getFootContactMarkers().sort(
      (a, b) =>
        Number(a.id === this.state.selectedFootContactMarkerId) -
        Number(b.id === this.state.selectedFootContactMarkerId),
    )) {
      const selected = marker.id === this.state.selectedFootContactMarkerId;
      if (!this.state.visibility.footContacts && !selected) continue;
      const point = this.screen(marker.world);
      for (const stroke of [
        { width: 5, color: 0xffffff },
        { width: selected ? 3 : 2, color: selected ? 0xe45f35 : 0x39845c },
      ]) {
        g.lineStyle(stroke.width, stroke.color)
          .strokeRect(point.x - 5, point.y - 5, 10, 10)
          .lineBetween(point.x - 10, point.y, point.x + 10, point.y)
          .lineBetween(point.x, point.y - 10, point.x, point.y + 10);
      }
      if (selected) label(`${marker.name} · contact`, point.x + 14, point.y + 12, '#a53d21');
    }
    const meshPoints = this.getMeshVertices();
    const mesh = this.state.selectedMesh;
    if (mesh && meshPoints.length) {
      for (const [a, b] of meshEdges(mesh)) {
        const p = meshPoints[a]!.screen,
          q = meshPoints[b]!.screen;
        const selected = this.state.selectedMeshEdge?.[0] === a && this.state.selectedMeshEdge[1] === b;
        g.lineStyle(selected ? 3 : 1, selected ? 0xffdc72 : 0x40d9ed, 0.95).lineBetween(p.x, p.y, q.x, q.y);
      }
      for (const vertex of meshPoints) {
        const { x, y } = vertex.screen;
        const selected = vertex.id === this.state.selectedMeshVertexId;
        const r = selected ? 8 : 6;
        g.fillStyle(selected ? 0xffdc72 : 0x40d9ed, 1);
        g.fillTriangle(x, y - r, x + r, y, x, y + r);
        g.fillTriangle(x, y - r, x, y + r, x - r, y);
        g.lineStyle(1, 0x010409, 1)
          .lineBetween(x, y - r, x + r, y)
          .lineBetween(x + r, y, x, y + r)
          .lineBetween(x, y + r, x - r, y)
          .lineBetween(x - r, y, x, y - r);
        if (selected) label(`Mesh: ${vertex.id}`, x + 12, y - 18, '#40d9ed');
      }
    }
    for (let i = labelIndex; i < this.labels.length; i += 1) this.labels[i]?.setVisible(false);
    // Cache only a completed draw so a failing renderer can be retried.
    this.drawSnapshot = snapshot;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gridGraphics.destroy();
    this.graphics.destroy();
    for (const label of this.labels) label.destroy();
  }
}
