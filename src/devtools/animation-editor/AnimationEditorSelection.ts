import type { AnimationClip } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import type { JointTransform, TransformProperty } from '../../engine/types.js';
import { findAdjacentBonePropertyKeyframe } from './keyframeQueries.js';
import {
  keyIdentity,
  keyframeSelectionIndex,
  reconcileKeyframeSelection,
  sameKey,
  type KeyframeSelectionState,
} from './keyframeSelection.js';
import { buildTimelineTracks, type KeyframeSelection, type TimelineTrack } from './timelineTracks.js';

type AnimationData = DeepReadonly<AnimationClip> | null;

/** Transient navigation, drafts and track layout; document history and playback stay in the session. */
export class AnimationEditorSelection {
  private bone: string | null = null;
  private selectedProperty: TransformProperty | null = null;
  private keySelection: KeyframeSelectionState = Object.freeze({ selectedKeys: Object.freeze([]), primaryKey: null });
  private rangeAnchor: KeyframeSelection | null = null;
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
    return this.keySelection.primaryKey;
  }
  get keys(): readonly KeyframeSelection[] {
    return this.keySelection.selectedKeys;
  }
  get anchor(): KeyframeSelection | null {
    return this.rangeAnchor;
  }
  get draft(): Readonly<Partial<JointTransform>> {
    return this.temporary;
  }
  get hasDraft(): boolean {
    return Object.keys(this.temporary).length > 0;
  }

  selectBone(id: string | null): boolean {
    if (id === this.bone && this.selectedProperty === null && this.keys.length === 0) return false;
    this.bone = id;
    this.selectedProperty = null;
    this.clearKey();
    this.clearDraft();
    return true;
  }

  selectProperty(boneId: string, property: TransformProperty): boolean {
    if (this.bone === boneId && this.selectedProperty === property && this.keys.length === 0) return false;
    this.bone = boneId;
    this.selectedProperty = property;
    this.clearKey();
    this.clearDraft();
    return true;
  }

  selectKey(selection: KeyframeSelection): void {
    this.setKeys([selection], selection);
    this.rangeAnchor = this.key;
  }

  setKeys(keys: readonly KeyframeSelection[], primary: KeyframeSelection | null, clearDraft = true): void {
    const selectedKeys = [...keyframeSelectionIndex(keys).values()].map((key) =>
      Object.isFrozen(key) && !('value' in key)
        ? key
        : Object.freeze({ boneId: key.boneId, property: key.property, time: key.time }),
    );
    Object.freeze(selectedKeys);
    const index = keyframeSelectionIndex(selectedKeys);
    const primaryKey = (primary && index.get(keyIdentity(primary))) || selectedKeys[0] || null;
    this.keySelection = Object.freeze({ selectedKeys, primaryKey });
    this.followPrimary(clearDraft);
    if (!this.rangeAnchor || !index.has(keyIdentity(this.rangeAnchor))) this.rangeAnchor = primaryKey;
  }

  hasKey(key: KeyframeSelection): boolean {
    return keyframeSelectionIndex(this.keys).has(keyIdentity(key));
  }

  private followPrimary(clearDraft = true): void {
    const primary = this.key;
    if (!primary) return;
    if (clearDraft || this.bone !== primary.boneId || this.selectedProperty !== primary.property) this.clearDraft();
    this.bone = primary.boneId;
    this.selectedProperty = primary.property;
    this.setExpanded(primary.boneId, true);
  }

  clearKey(): boolean {
    if (!this.keys.length) return false;
    this.keySelection = Object.freeze({ selectedKeys: Object.freeze([]), primaryKey: null });
    this.rangeAnchor = null;
    return true;
  }

  resetAnimation(): void {
    this.selectedProperty = null;
    this.clearKey();
    this.clearDraft();
  }

  validateKey(animation: AnimationData): void {
    const next = reconcileKeyframeSelection(animation, this.keySelection);
    if (next === this.keySelection) return;
    this.keySelection = next;
    this.followPrimary(false);
    if (!this.rangeAnchor || !this.hasKey(this.rangeAnchor)) this.rangeAnchor = this.key;
  }

  /** Authored deletion removes the exact resolved reference before tolerant reconciliation. */
  removeKey(ref: KeyframeSelection): void {
    if (!this.hasKey(ref)) return;
    this.setKeys(
      this.keys.filter((key) => !sameKey(key, ref)),
      this.key,
      false,
    );
  }

  moveKey(from: KeyframeSelection, to: KeyframeSelection): void {
    const anchorMoved = this.rangeAnchor && sameKey(this.rangeAnchor, from);
    this.setKeys(
      this.keys.map((key) => (sameKey(key, from) ? to : key)),
      to,
    );
    if (anchorMoved) this.rangeAnchor = this.key;
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
