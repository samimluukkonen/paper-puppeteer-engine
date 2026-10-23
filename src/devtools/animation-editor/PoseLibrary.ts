import { canonicalJson } from '../../engine/authoredSerialization.js';
import { equalJsonData } from '../../engine/equalJsonData.js';
import { parsePoseDefinition, type PoseDefinition } from '../../engine/Pose.js';
import { freezeData, type DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { identifierSchema } from '../../engine/schemas.js';
import { createTransform } from '../../engine/types.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';

export interface LibraryPose {
  readonly id: string;
  readonly pose: DeepReadonly<PoseDefinition>;
  readonly characterId: string;
  readonly rigSignature: string;
}

const signatures = new WeakMap<Rig, string>();
/** Exact structural/FK/IK compatibility, independent of artwork, display names and bone array order. */
export function poseRigSignature(rig: Rig): string {
  let signature = signatures.get(rig);
  if (signature === undefined) {
    signature = canonicalJson({
      root: rig.root,
      bones: rig.bones
        .map((bone) => ({ id: bone.id, parent: bone.parent ?? null, ...createTransform(bone) }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      ik: [...(rig.ik ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    });
    signatures.set(rig, signature);
  }
  return signature;
}

/** A character document domain using the same bounded snapshot history as rig/project editing. */
export class PoseLibrary {
  private entries: readonly LibraryPose[];
  private readonly history: SnapshotHistory<readonly LibraryPose[]>;
  private packaged: readonly DeepReadonly<PoseDefinition>[] | undefined;

  constructor(
    readonly characterId: string,
    rig: Rig | undefined,
    poses: readonly DeepReadonly<PoseDefinition>[],
    private readonly changed: () => void,
    private readonly currentRig?: () => Rig | undefined,
  ) {
    this.entries = freezeData(
      poses.map((source) => {
        if (!rig) throw new Error('Load a rig before opening poses.');
        const pose = parsePoseDefinition(source, rig);
        return {
          id: pose.library?.id ?? `legacy:${pose.name}`,
          pose,
          characterId: pose.library?.characterId ?? characterId,
          rigSignature: pose.library?.rigSignature ?? poseRigSignature(rig),
        };
      }),
    );
    if (new Set(this.entries.map(({ id }) => id)).size !== this.entries.length)
      throw new Error('Duplicate pose library IDs.');
    this.history = new SnapshotHistory(
      () => this.entries,
      (entries) => {
        const rig = this.currentRig?.();
        if (rig) {
          for (const { pose } of entries) {
            const missing = Object.keys(pose.bones).filter((id) => !rig.hasBone(id));
            if (missing.length)
              throw new Error(
                `Cannot restore pose "${pose.name}": missing bones ${missing.join(', ')}. Undo the rig changes first.`,
              );
          }
        }
        this.entries = entries;
      },
      equalJsonData,
    );
  }

  get poses(): readonly LibraryPose[] {
    return this.entries;
  }
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }
  packagePoses(): readonly DeepReadonly<PoseDefinition>[] {
    return (this.packaged ??= Object.freeze(this.entries.map(({ pose }) => pose)));
  }
  get(id: string): LibraryPose {
    const entry = this.entries.find((pose) => pose.id === id);
    if (!entry) throw new Error('Select an available pose.');
    return entry;
  }
  compatibility(id: string, rig: Rig | undefined): string | undefined {
    const entry = this.get(id);
    if (!rig) return 'Load a character rig first.';
    const missing = Object.keys(entry.pose.bones).filter((bone) => !rig.hasBone(bone));
    if (missing.length) return `Missing bones: ${missing.join(', ')}. Restore the compatible rig.`;
    if (entry.characterId !== this.characterId) return 'This pose belongs to a different character.';
    if (entry.rigSignature !== poseRigSignature(rig))
      return 'The rig hierarchy, bind transforms or IK configuration changed. Restore the compatible rig or save a new pose.';
    return undefined;
  }
  private name(name: string, except?: string): string {
    const value = identifierSchema.parse(name.trim());
    if (this.entries.some((entry) => entry.id !== except && entry.pose.name === value))
      throw new Error('A pose with this name already exists. Choose another name.');
    return value;
  }
  private publish(): void {
    this.packaged = undefined;
    this.changed();
  }
  add(pose: PoseDefinition, rig: Rig): string {
    const id = crypto.randomUUID();
    const name = this.name(pose.name);
    const rigSignature = poseRigSignature(rig);
    const owned = parsePoseDefinition(
      {
        ...pose,
        name,
        library: { id, characterId: this.characterId, rigSignature, space: 'fk-local' },
      },
      rig,
    );
    this.history.change(() => {
      this.entries = freezeData([...this.entries, { id, pose: owned, characterId: this.characterId, rigSignature }]);
    });
    this.publish();
    return id;
  }
  rename(id: string, name: string): void {
    const entry = this.get(id);
    const value = this.name(name, id);
    if (value === entry.pose.name) return;
    this.history.change(() => {
      this.entries = freezeData(
        this.entries.map((item) =>
          item.id === id
            ? {
                ...entry,
                pose: {
                  ...entry.pose,
                  name: value,
                  library: {
                    id,
                    characterId: entry.characterId,
                    rigSignature: entry.rigSignature,
                    space: 'fk-local' as const,
                  },
                },
              }
            : item,
        ),
      );
    });
    this.publish();
  }
  delete(id: string): void {
    this.get(id);
    this.history.change(() => {
      this.entries = Object.freeze(this.entries.filter((entry) => entry.id !== id));
    });
    this.publish();
  }
  undo(): boolean {
    const changed = this.history.undo();
    if (changed) this.publish();
    return changed;
  }
  redo(): boolean {
    const changed = this.history.redo();
    if (changed) this.publish();
    return changed;
  }
}
