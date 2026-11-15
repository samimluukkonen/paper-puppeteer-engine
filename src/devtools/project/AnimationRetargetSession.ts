import {
  retargetAnimation,
  parseAnimationClip,
  Rig,
  rigCompatibilityRevision,
  type RetargetOptions,
  type RetargetResult,
  type RigBoneMapping,
} from '../../engine/core.js';
import type { AnimationClip } from '../../engine/data.js';
import type { AnimationLibraryEntry } from '../shared/animationLibraryData.js';
import type { AnimationPreviewLease } from '../shared/AnimationLibraryPreviewDialog.js';
import type { GroundGuide } from '../shared/groundGuide.js';
import { buildCharacterPackage, openPackageRuntime, type PackageSnapshot } from '../shared/package/characterPackage.js';
import { CHARACTER_PREVIEW_ORIGIN } from '../shared/previewPlacement.js';
import { characterFileFetcher } from './projectPackage.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

/** Detached proposals only. The target Animation Editor remains the sole document owner. */
export class AnimationRetargetSession {
  readonly source: PackageSnapshot;
  readonly sourceAnimation: AnimationClip;
  readonly sourceCharacter: string;
  readonly groundReference: GroundGuide;
  readonly name = `retarget-${crypto.randomUUID()}`;
  target: PackageSnapshot | undefined;
  targetCharacter = '';
  mapping: RigBoneMapping | undefined;
  options: RetargetOptions = { name: this.name, translation: 'scale-by-bone', rootMotion: 'preserve', ik: 'fk-only' };
  result: RetargetResult | undefined;

  constructor(
    private readonly workspace: ProjectWorkspace,
    entry: AnimationLibraryEntry,
  ) {
    workspace.rigSource(entry.character); // Reject temporary edits before capturing authored data.
    this.sourceCharacter = entry.character;
    const ground = workspace.animationPreviewPreferences(entry.character)?.ground;
    this.groundReference = {
      enabled: ground?.enabled ?? false,
      y: ground ? ground.y - CHARACTER_PREVIEW_ORIGIN.y : 0,
      snapEnabled: false,
    };
    this.source = workspace.captureCharacter(entry.character);
    const animation = this.source.animations.find(({ name }) => name === entry.clip.name);
    if (!animation) throw new Error('Source animation is unavailable. Reopen the Animation Library.');
    this.sourceAnimation = structuredClone(parseAnimationClip({ version: 1, ...animation }, new Rig(this.source.rig)));
  }
  selectTarget(id: string): void {
    if (id === this.sourceCharacter) throw new Error('Choose another character for retargeting.');
    if (id) this.workspace.rigSource(id);
    const snapshot = id ? this.workspace.captureCharacter(id) : undefined;
    this.targetCharacter = id;
    this.target = snapshot;
    this.mapping = undefined;
    const { pelvis: _pelvis, ...options } = this.options;
    this.options = options;
    this.result = undefined;
  }
  selectMapping(mapping: RigBoneMapping | undefined): void {
    this.mapping = mapping && structuredClone(mapping);
    if (this.options.pelvis)
      this.options = {
        ...this.options,
        pelvis: {
          ...this.options.pelvis,
          sourceBoneIds: this.options.pelvis.sourceBoneIds.filter((id) =>
            mapping?.entries.some(({ sourceBoneId }) => sourceBoneId === id),
          ),
        },
      };
    this.result = undefined;
  }
  setOptions(options: RetargetOptions): void {
    this.options = { ...structuredClone(options), name: this.name };
    this.result = undefined;
  }
  assertCurrent(): void {
    if (!this.target) throw new Error('Choose a target character.');
    for (const [id, snapshot] of [
      [this.sourceCharacter, this.source],
      [this.targetCharacter, this.target],
    ] as const) {
      if (rigCompatibilityRevision(this.workspace.rigSource(id).rig) !== rigCompatibilityRevision(snapshot.rig))
        throw new Error('A rig changed. Reopen retargeting and review the current mapping.');
    }
  }
  preview(): RetargetResult {
    this.result = undefined;
    this.assertCurrent();
    if (!this.mapping || !this.target) throw new Error('Select or save a reviewed bone mapping first.');
    this.result = retargetAnimation({
      sourceAnimation: this.sourceAnimation,
      sourceRig: { id: this.sourceCharacter, rig: this.source.rig },
      targetRig: { id: this.targetCharacter, rig: this.target.rig },
      boneMapping: this.mapping,
      options: this.options,
    });
    return this.result;
  }
  acceptedAnimation(): AnimationClip {
    this.assertCurrent();
    if (!this.result?.animation) throw new Error('Generate and review a valid preview first.');
    return structuredClone(this.result.animation);
  }
  /** Capture both package proposals before loading; failures and late cancellation release every lease. */
  previewLoader(): (signal: AbortSignal) => Promise<readonly [AnimationPreviewLease, AnimationPreviewLease]> {
    const animation = this.acceptedAnimation();
    const source = { ...this.source, animations: [this.sourceAnimation] };
    const target = { ...this.target!, animations: [animation] };
    const fetchers = [this.sourceCharacter, this.targetCharacter].map((id) =>
      characterFileFetcher(this.workspace.character(id).files),
    );
    return async (signal) => {
      const leases: AnimationPreviewLease[] = [];
      try {
        for (const [index, snapshot] of [source, target].entries()) {
          const files = await buildCharacterPackage(snapshot, fetchers[index], signal);
          leases.push(await openPackageRuntime(files, signal, `retarget_${crypto.randomUUID().replaceAll('-', '_')}`));
          signal.throwIfAborted();
        }
        return [leases[0]!, leases[1]!] as const;
      } catch (error) {
        for (const lease of leases) lease.dispose();
        throw error;
      }
    };
  }
}
