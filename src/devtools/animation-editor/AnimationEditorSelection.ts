import type { AnimationClip } from '../../engine/AnimationClip.js';
import type { IKAnimationProperty } from '../../engine/ik/animationKeyframes.js';
import { findIKPropertyKeyframe } from '../../engine/ik/animationKeyframes.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import type { JointTransform, TransformProperty } from '../../engine/types.js';
import { findAnimationEvent, type AnimationEventRef } from './animationEvents.js';
import { type IKKeyframeSelection } from './ikTimeline.js';
import { findAdjacentBonePropertyKeyframe } from './keyframeQueries.js';
import {
  keyIdentity,
  keyframeSelectionIndex,
  reconcileKeyframeSelection,
  sameKey,
  type KeyframeSelectionState,
} from './keyframeSelection.js';
import { buildTimelineTracks, type KeyframeSelection, type TimelineTrack } from './timelineTracks.js';
import { type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

type AnimationData = DeepReadonly<AnimationClip> | null;

/** Transient navigation, drafts and track layout; document history and playback stay in the session. */
export class AnimationEditorSelection {
  private ik: {
    readonly kind: 'ik';
    readonly constraintId: string;
    readonly property: IKAnimationProperty | null;
  } | null = null;
  private ikKey: IKKeyframeSelection | null = null;
  private ikTemporary: Readonly<Partial<Record<IKAnimationProperty, number>>> = Object.freeze({});
  get ikTarget() {
    return this.ik;
  }
  get ikKeyframe() {
    return this.ikKey;
  }
  get ikDraft() {
    return this.ikTemporary;
  }
  selectIK(id: string, property: IKAnimationProperty | null = null, key: IKKeyframeSelection | null = null): void {
    this.selectBone(null);
    this.clearDraft();
    this.ik = Object.freeze({ kind: 'ik', constraintId: id, property });
    this.ikKey = key;
    if (key) this.setIKExpanded(id, true);
  }
  setIKDraft(property: IKAnimationProperty, value: number): void {
    this.ikTemporary = Object.freeze({ ...this.ikTemporary, [property]: value });
  }
  clearIKDraftProperty(property: IKAnimationProperty): void {
    const next = { ...this.ikTemporary };
    delete next[property];
    this.ikTemporary = Object.freeze(next);
  }
  clearIKKey(): boolean {
    if (!this.ikKey) return false;
    this.ikKey = null;
    return true;
  }
  setIKKey(key: IKKeyframeSelection | null): void {
    this.ikKey = key;
  }
  private clearIK(): void {
    this.ik = null;
    this.ikKey = null;
  }
  private bone: string | null = null;
  private selectedProperty: TransformProperty | null = null;
  private selectedEvent: AnimationEventRef | null = null;
  private keySelection: KeyframeSelectionState = Object.freeze({ selectedKeys: Object.freeze([]), primaryKey: null });
  private rangeAnchor: KeyframeSelection | null = null;
  private temporary: Readonly<Partial<JointTransform>> = Object.freeze({});
  private readonly expandedIK = new Set<string>();
  private readonly expandedBones = new Set<string>();
  private rows: readonly TimelineTrack[] | undefined;
  private rowsDirty = true;
  private rowAnimation: AnimationData | undefined;

  constructor(private readonly rig: Rig | undefined) {}

  private boneTarget: { readonly kind: 'bone'; readonly boneId: string } | null = null;
  get target() {
    if (this.ik) return this.ik;
    if (!this.bone) return null;
    if (this.boneTarget?.boneId !== this.bone) this.boneTarget = Object.freeze({ kind: 'bone', boneId: this.bone });
    return this.boneTarget;
  }
  get boneId(): string | null {
    return this.bone;
  }
  get event(): AnimationEventRef | null {
    return this.selectedEvent;
  }

  selectEvent(ref: AnimationEventRef): void {
    this.clearKey();
    this.clearDraft();
    this.clearIK();
    this.bone = null;
    this.selectedProperty = null;
    this.selectedEvent = ref;
  }

  clearEvent(): boolean {
    if (!this.selectedEvent) return false;
    this.selectedEvent = null;
    return true;
  }

  validateEvent(animation: AnimationData): void {
    if (this.selectedEvent && !findAnimationEvent(animation, this.selectedEvent)) this.clearEvent();
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
    return Object.keys(this.temporary).length > 0 || Object.keys(this.ikTemporary).length > 0;
  }

  selectBone(id: string | null): boolean {
    if (id === this.bone && this.selectedProperty === null && this.keys.length === 0 && !this.selectedEvent && !this.ik)
      return false;
    this.clearEvent();
    this.clearIK();
    this.bone = id;
    this.selectedProperty = null;
    this.clearKey();
    this.clearDraft();
    return true;
  }

  selectProperty(boneId: string, property: TransformProperty): boolean {
    if (
      this.bone === boneId &&
      this.selectedProperty === property &&
      this.keys.length === 0 &&
      !this.selectedEvent &&
      !this.ik
    )
      return false;
    this.clearEvent();
    this.clearIK();
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
    this.clearEvent();
    this.clearIK();
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
    this.clearIK();
    this.clearEvent();
    this.selectedProperty = null;
    this.clearKey();
    this.clearDraft();
  }

  validateKey(animation: AnimationData): void {
    if (this.ikKey && this.rig) {
      const key =
        animation &&
        findIKPropertyKeyframe(
          animation,
          this.rig,
          this.ikKey.constraintId,
          this.ikKey.property,
          toMilliseconds(this.ikKey.time),
        );
      this.ikKey = key
        ? toSeconds(key.time) === this.ikKey.time
          ? this.ikKey
          : Object.freeze({ ...this.ikKey, time: toSeconds(key.time) })
        : null;
    }
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

  adjacentKey(animation: AnimationData, timeSeconds: Seconds, direction: -1 | 1): KeyframeSelection | undefined {
    const boneId = this.bone;
    const property = this.selectedProperty;
    if (!animation || !boneId || !property) return undefined;
    const key = findAdjacentBonePropertyKeyframe(animation, boneId, property, toMilliseconds(timeSeconds), direction);
    return key ? Object.freeze({ boneId, property, time: toSeconds(key.time) }) : undefined;
  }

  tracks(animation: AnimationData): readonly TimelineTrack[] {
    if (!this.rows || this.rowsDirty || this.rowAnimation !== animation) {
      this.rows = buildTimelineTracks(this.rig, animation, this.expandedBones, this.rows, this.expandedIK);
      this.rowAnimation = animation;
      this.rowsDirty = false;
    }
    return this.rows;
  }

  isIKExpanded(id: string): boolean {
    return this.expandedIK.has(id);
  }
  setIKExpanded(id: string, expanded: boolean): boolean {
    if (this.expandedIK.has(id) === expanded) return false;
    if (expanded) this.expandedIK.add(id);
    else this.expandedIK.delete(id);
    this.rowsDirty = true;
    return true;
  }
  isExpanded(boneId: string): boolean {
    return this.expandedBones.has(boneId);
  }
  setExpanded(boneId: string, expanded: boolean): boolean {
    if (this.expandedBones.has(boneId) === expanded) return false;
    if (expanded) this.expandedBones.add(boneId);
    else this.expandedBones.delete(boneId);
    this.rowsDirty = true;
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
  clearIKDraft(): boolean {
    if (!Object.keys(this.ikTemporary).length) return false;
    this.ikTemporary = Object.freeze({});
    return true;
  }
  clearDraft(): boolean {
    if (!this.hasDraft) return false;
    this.temporary = Object.freeze({});
    this.ikTemporary = Object.freeze({});
    return true;
  }
}
