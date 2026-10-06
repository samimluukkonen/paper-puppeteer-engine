import type { AnimationClip } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import type { JointTransform, TransformProperty } from '../../engine/types.js';
import { findAdjacentBonePropertyKeyframe, findBonePropertyKeyframe } from './keyframes.js';
import { buildTimelineTracks, type KeyframeSelection, type TimelineTrack } from './timelineTracks.js';

type AnimationData = DeepReadonly<AnimationClip> | null;

/** Transient navigation, drafts and track layout; document history and playback stay in the session. */
export class AnimationEditorSelection {
  private bone: string | null = null;
  private selectedProperty: TransformProperty | null = null;
  private selectedKey: KeyframeSelection | null = null;
  private temporary: Readonly<Partial<JointTransform>> = Object.freeze({});
  private readonly expandedBones = new Set<string>();
  private rows: readonly TimelineTrack[] | undefined;
  private rowAnimation: AnimationData | undefined;

  constructor(private readonly rig: Rig | undefined) {}

  get boneId(): string | null {
    return this.bone;
  }
  get property(): TransformProperty | null {
    return this.selectedProperty;
  }
  get key(): KeyframeSelection | null {
    return this.selectedKey;
  }
  get draft(): Readonly<Partial<JointTransform>> {
    return this.temporary;
  }
  get hasDraft(): boolean {
    return Object.keys(this.temporary).length > 0;
  }

  selectBone(id: string | null): boolean {
    if (id === this.bone && this.selectedProperty === null && this.selectedKey === null) return false;
    this.bone = id;
    this.selectedProperty = null;
    this.selectedKey = null;
    this.clearDraft();
    return true;
  }

  selectProperty(boneId: string, property: TransformProperty): boolean {
    if (this.bone === boneId && this.selectedProperty === property && this.selectedKey === null) return false;
    this.bone = boneId;
    this.selectedProperty = property;
    this.selectedKey = null;
    this.clearDraft();
    return true;
  }

  selectKey(selection: KeyframeSelection): void {
    this.clearDraft();
    this.bone = selection.boneId;
    this.selectedProperty = selection.property;
    this.selectedKey = Object.freeze({ ...selection });
    this.setExpanded(selection.boneId, true);
  }

  clearKey(): boolean {
    if (!this.selectedKey) return false;
    this.selectedKey = null;
    return true;
  }

  resetAnimation(): void {
    this.selectedProperty = null;
    this.selectedKey = null;
    this.clearDraft();
  }

  validateKey(animation: AnimationData): void {
    const selection = this.selectedKey;
    if (!selection) return;
    const key = animation
      ? findBonePropertyKeyframe(animation, selection.boneId, selection.property, selection.time * 1000)
      : undefined;
    if (!key) this.selectedKey = null;
    else if (key.time / 1000 !== selection.time)
      this.selectedKey = Object.freeze({ ...selection, time: key.time / 1000 });
  }

  adjacentKey(animation: AnimationData, timeSeconds: number, direction: -1 | 1): KeyframeSelection | undefined {
    const boneId = this.bone;
    const property = this.selectedProperty;
    if (!animation || !boneId || !property) return undefined;
    const key = findAdjacentBonePropertyKeyframe(animation, boneId, property, timeSeconds * 1000, direction);
    return key ? Object.freeze({ boneId, property, time: key.time / 1000 }) : undefined;
  }

  tracks(animation: AnimationData): readonly TimelineTrack[] {
    if (!this.rows || this.rowAnimation !== animation) {
      this.rows = buildTimelineTracks(this.rig, animation, this.expandedBones);
      this.rowAnimation = animation;
    }
    return this.rows;
  }

  isExpanded(boneId: string): boolean {
    return this.expandedBones.has(boneId);
  }
  setExpanded(boneId: string, expanded: boolean): boolean {
    if (this.expandedBones.has(boneId) === expanded) return false;
    if (expanded) this.expandedBones.add(boneId);
    else this.expandedBones.delete(boneId);
    this.rows = undefined;
    return true;
  }

  setDraft(property: TransformProperty, value: number): void {
    this.temporary = Object.freeze({ ...this.temporary, [property]: value });
  }
  clearDraftProperty(property: TransformProperty): void {
    if (this.temporary[property] === undefined) return;
    const draft = { ...this.temporary };
    delete draft[property];
    this.temporary = Object.freeze(draft);
  }
  clearDraft(): boolean {
    if (!this.hasDraft) return false;
    this.temporary = Object.freeze({});
    return true;
  }
}
