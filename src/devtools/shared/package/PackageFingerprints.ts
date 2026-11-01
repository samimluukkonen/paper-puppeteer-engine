import type { AnimationClip } from '../../../engine/AnimationClip.js';
import { ANIMATION_FORMAT_VERSION } from '../../../engine/externalData.js';
import { isFullyFrozen } from '../../../engine/readonlyData.js';
import { draftSource } from '../draftSource.js';
import type { PackageSnapshot } from './characterPackage.js';

export type PackageDomains = Readonly<Record<'Rig' | 'Skins' | 'Animations' | 'Poses' | 'Assets', string>>;

/** Only immutable branches can reuse an identity-based fingerprint. Blobs are immutable binaries. */
function immutableInputs(inputs: readonly unknown[]): boolean {
  return inputs.every(
    (input) => input === null || typeof input !== 'object' || input instanceof Blob || isFullyFrozen(input),
  );
}

/** Cache domains independently and retain clip digests weakly across edits and undo. */
export class PackageFingerprints {
  private readonly domains = new Map<keyof PackageDomains, { inputs: readonly unknown[]; digest: string }>();
  private readonly clips = new WeakMap<AnimationClip, string>();
  private readonly blobIds = new WeakMap<Blob, number>();
  private blobSerial = 0;

  constructor(private readonly digest: typeof draftSource = draftSource) {}

  private domain(name: keyof PackageDomains, inputs: readonly unknown[], data: () => unknown): string {
    const reusable = immutableInputs(inputs);
    const previous = this.domains.get(name);
    if (
      reusable &&
      previous?.inputs.length === inputs.length &&
      inputs.every((input, index) => input === previous.inputs[index])
    )
      return previous.digest;
    const digest = this.digest(data());
    if (reusable) this.domains.set(name, { inputs, digest });
    else this.domains.delete(name);
    return digest;
  }

  private clip(clip: AnimationClip): string {
    const reusable = isFullyFrozen(clip);
    const previous = reusable ? this.clips.get(clip) : undefined;
    if (previous !== undefined) return previous;
    const digest = this.digest({ ...clip, version: ANIMATION_FORMAT_VERSION });
    if (reusable) this.clips.set(clip, digest);
    return digest;
  }

  compute(snapshot: PackageSnapshot): PackageDomains {
    const { skins: embedded, ...rig } = snapshot.rig;
    return {
      Rig: this.domain('Rig', Object.entries(rig).flat(), () => rig),
      Skins: this.domain(
        'Skins',
        [snapshot.identity?.id, snapshot.identity?.defaultSkin, embedded, ...snapshot.skins],
        () => [snapshot.identity ?? null, embedded, snapshot.skins],
      ),
      Animations: this.domain('Animations', snapshot.animations, () =>
        snapshot.animations.map((clip) => this.clip(clip)),
      ),
      Poses: this.domain(
        'Poses',
        snapshot.poses ?? snapshot.definition.poses,
        () => snapshot.poses ?? snapshot.definition.poses,
      ),
      Assets: this.domain(
        'Assets',
        snapshot.replacements.flatMap((entry) => [
          entry.blob,
          entry.assetKey,
          entry.reference,
          entry.format,
          entry.originScaleX,
          entry.originScaleY,
          entry.newAsset,
        ]),
        () =>
          snapshot.replacements.map((entry) => {
            let id = this.blobIds.get(entry.blob);
            if (id === undefined) {
              id = ++this.blobSerial;
              this.blobIds.set(entry.blob, id);
            }
            return { ...entry, blob: id };
          }),
      ),
    };
  }

  clear(): void {
    this.domains.clear();
  }
}
