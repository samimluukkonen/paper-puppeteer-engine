import { Rig } from '../../engine/core.js';
import type { CharacterDefinition } from '../../engine/data.js';
import { getCharacterPreviewSettings } from '../../shared/characterPreviewSettings.js';
import { createCharacterDocuments } from '../animation-editor/characterDocuments.js';
import { ArtworkController } from '../shared/artwork/ArtworkController.js';
import type { PackageSnapshot } from '../shared/package/characterPackage.js';

/** Authored state lives in the project realm and never owns a renderer or runtime lease. */
export class ProjectCharacterDocument {
  readonly animation;
  readonly rig;
  readonly artwork: ArtworkController;

  constructor(
    private readonly definition: CharacterDefinition,
    confirmReplacement: (texture: string) => boolean,
    skinReferences: (skin: string) => readonly string[],
  ) {
    const chains = getCharacterPreviewSettings(definition.id).ikChains;
    const documents = createCharacterDocuments(definition, {
      boneReferences: (id) =>
        chains
          .filter((chain) => [chain.rootBone, chain.middleBone, chain.endBone].includes(id))
          .map((chain) => `preview IK constraint "${chain.name}"`),
      ikReferences: (id) =>
        chains
          .filter((chain) => chain.name === id)
          .map((chain) => `preview IK constraint "${chain.name}" (target/provider ownership)`),
    });
    this.animation = documents.animation;
    this.rig = documents.rig;
    this.rig.skinReferences = skinReferences;
    this.animation.selectAnimation(this.animation.animationIds[0] ?? null);
    this.artwork = new ArtworkController(undefined, confirmReplacement);
  }

  readonly capture = (): PackageSnapshot => ({
    definition: this.definition,
    rig: this.rig.recoveryDraft,
    skins: this.rig.standaloneSkins,
    animations: this.animation.packageAnimations(),
    poses: this.animation.poseLibrary.packagePoses(),
    replacements: this.artwork.appliedReplacements(),
    pendingArtwork: this.artwork.hasPendingProposal,
  });

  releaseRenderer(): void {
    this.animation.setReplacementGuard(undefined);
    this.rig.setArtworkValidator(undefined);
    // A preview may have supplied a Rig from its iframe realm. Retain its last valid data
    // through our own class so its prototype cannot keep that removed window alive.
    if (this.animation.rig) this.animation.updatePreviewRig(new Rig(this.animation.rig));
  }
}
