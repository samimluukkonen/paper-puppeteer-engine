import type Phaser from 'phaser';
import type { Facing, Puppet } from '../engine/index.js';
import { downloadJson } from '../shared/downloadJson.js';
import { type DemoCharacterProfile, demoPuppetProfile } from './demoCharacterProfiles.js';
import { demoAuthoringLayout } from './demoPresentation.js';
import { swapSketchLimbs } from './SketchFacingLayout.js';

/** Static pose editing and the scene-space authoring inspector. */
export class DemoPoseAuthoring {
  active = false;
  private selectedBone = 0;
  private readonly poseText: Phaser.GameObjects.Text;
  private readonly poseMarker: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly profile: DemoCharacterProfile = demoPuppetProfile,
  ) {
    this.poseMarker = scene.add.graphics().setDepth(190);
    this.poseText = scene.add
      .text(18, 75, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#26342b',
        backgroundColor: '#f5f1df',
        padding: { x: 10, y: 8 },
        lineSpacing: 3,
      })
      .setDepth(200)
      .setVisible(false);
  }

  enter(): void {
    this.active = true;
    this.poseText.setVisible(true);
    this.poseMarker.clear();
    this.resetAuthoringPose();
    this.refresh();
  }

  exit(): void {
    this.active = false;
    this.poseText.setVisible(false);
    this.poseMarker.clear();
  }

  face(direction: Facing): void {
    if (this.profile.layout === 'authored') {
      this.puppet.preparePose();
      if (this.profile.swapLimbsWithFacing && this.puppet.facingDirection !== direction) swapSketchLimbs(this.puppet);
      this.puppet.setFacing(direction);
      return;
    }
    const previous = demoAuthoringLayout(this.puppet.rig, this.puppet.facingDirection);
    const next = demoAuthoringLayout(this.puppet.rig, direction);
    this.puppet.preparePose();
    for (const [id, x] of Object.entries(next.positions)) {
      const bone = this.puppet.getBone(id);
      bone.pose.x += x - previous.positions[id as keyof typeof previous.positions];
    }
    for (const [id, rotation] of Object.entries(next.rotations)) {
      const bone = this.puppet.getBone(id);
      bone.pose.rotation += rotation - previous.rotations[id as keyof typeof previous.rotations];
    }
    this.puppet.setRenderOrder(next.order, next.slotDepths).setFacing(direction);
  }

  selectBone(direction: number): void {
    if (!this.active) return;
    this.selectedBone = (this.selectedBone + direction + this.puppet.rig.bones.length) % this.puppet.rig.bones.length;
    this.refresh();
  }

  adjustSelected(property: 'x' | 'y' | 'rotation', change: number): void {
    if (!this.active) return;
    this.puppet.preparePose();
    const bone = this.puppet.getBone(this.puppet.rig.bones[this.selectedBone]!.id);
    bone.pose[property] += change;
    this.puppet.syncPose();
    this.refresh();
  }

  resetSelectedBone(): void {
    if (!this.active) return;
    this.puppet.preparePose();
    this.puppet.getBone(this.puppet.rig.bones[this.selectedBone]!.id).reset();
    this.puppet.syncPose();
    this.refresh();
  }

  resetBind(): void {
    if (!this.active) return;
    this.resetAuthoringPose();
    this.refresh();
  }

  applyCombatPose(): void {
    if (!this.active) return;
    if (this.profile.layout === 'authored') {
      this.puppet.resetToBindPose().applyPose('combat-ready').commitPoseForEditing();
      this.puppet.container.setPosition(
        this.scene.scale.width / 2,
        this.scene.scale.height - this.profile.placement.yOffset,
      );
      if (this.profile.swapLimbsWithFacing && this.puppet.facingDirection === 'left') swapSketchLimbs(this.puppet);
      this.puppet.syncPose();
      this.refresh();
      return;
    }
    this.resetAuthoringPose();
    this.puppet.applyPose('combat-ready').commitPoseForEditing();
    this.refresh();
  }

  private resetAuthoringPose(): void {
    if (this.profile.layout === 'authored') {
      this.puppet.resetToBindPose();
      this.puppet.container.setPosition(
        this.scene.scale.width / 2,
        this.scene.scale.height - this.profile.placement.yOffset,
      );
      if (this.profile.swapLimbsWithFacing && this.puppet.facingDirection === 'left') swapSketchLimbs(this.puppet);
      this.puppet.syncPose();
      return;
    }
    const layout = demoAuthoringLayout(this.puppet.rig, this.puppet.facingDirection);
    this.puppet.resetToBindPose().setRenderOrder(layout.order, layout.slotDepths);
    this.puppet.container.setPosition(
      this.scene.scale.width / 2,
      this.scene.scale.height - this.profile.placement.yOffset,
    );
    for (const [id, x] of Object.entries(layout.positions)) this.puppet.getBone(id).pose.x = x;
    for (const [id, rotation] of Object.entries(layout.rotations)) this.puppet.getBone(id).pose.rotation = rotation;
    this.puppet.syncPose();
  }

  exportCurrentPose(): void {
    if (!this.active) return;
    const canonical = this.profile.swapLimbsWithFacing && this.puppet.facingDirection === 'left';
    this.puppet.preparePose();
    if (canonical) swapSketchLimbs(this.puppet);
    const pose = this.puppet.exportPose('exported-pose');
    if (canonical) {
      swapSketchLimbs(this.puppet);
      this.puppet.syncPose();
    }
    const json = JSON.stringify(pose, null, 2);
    console.log(`Exported pose JSON:\n${json}`);
    void navigator.clipboard?.writeText(json).catch(() => {});
    downloadJson(json, 'exported-pose.json');
  }

  exportRig(): void {
    if (!this.active) return;
    console.log(`Normalized rig data:\n${JSON.stringify(this.puppet.exportRig(), null, 2)}`);
  }

  refresh(): void {
    if (!this.active) return;
    const id = this.puppet.rig.bones[this.selectedBone]!.id;
    const selected = this.puppet.getBone(id);
    const { x, y, rotation, scaleX, scaleY } = selected.pose;
    const point = selected.getWorldPosition();
    this.poseMarker.clear().lineStyle(2, 0xc04e30, 1).strokeCircle(point.x, point.y, 11);
    this.poseMarker.lineBetween(point.x - 16, point.y, point.x + 16, point.y);
    this.poseMarker.lineBetween(point.x, point.y - 16, point.x, point.y + 16);
    this.poseText.setText([
      'POSE AUTHORING · animation paused · IK off',
      `Facing: ${this.puppet.facingDirection}`,
      `Selected bone: ${id} (${this.selectedBone + 1}/${this.puppet.rig.bones.length})`,
      `x: ${x.toFixed(3)}   y: ${y.toFixed(3)}`,
      `rotation: ${rotation.toFixed(3)} rad`,
      `scaleX: ${scaleX.toFixed(3)}   scaleY: ${scaleY.toFixed(3)}`,
      '[ / ] select · ← / → rotate · Shift coarse',
      'Alt + ← / → x · ↑ / ↓ y · U reset bone',
      'C preset · R bind · X export · J rig data',
    ]);
  }
}
