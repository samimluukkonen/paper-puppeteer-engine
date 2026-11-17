import { CharacterDefinition, meshDeformationIssues, Rig } from '../../engine/core.js';
import { RigEditorState, type RigEditorStateOptions } from '../rig-editor/RigEditorState.js';
import { assertCharacterIdAvailable, newCharacterSchema, type NewCharacterOptions } from '../shared/newCharacter.js';
import { AnimationEditorState } from './AnimationEditorState.js';

export type CharacterWorkspace = ReturnType<typeof createNewCharacter>;

/** One owner per editing domain, used by both loaded characters and new drafts. */
export function createCharacterDocuments(definition: CharacterDefinition, options: RigEditorStateOptions = {}) {
  const file = definition.rigFile;
  const animation = new AnimationEditorState(definition.rig, definition.animations, {
    animationPaths: definition.animationPaths,
    characterId: definition.id,
    poses: definition.poses,
  });
  return {
    animation,
    rig: new RigEditorState(new Rig(definition.rig, file?.skins ?? []), file, {
      ...options,
      meshReferences: (candidate) => [
        ...animation
          .packageAnimations()
          .flatMap((clip) =>
            meshDeformationIssues(clip.deformationTracks, candidate).map(
              (issue) => `animation "${clip.name}": ${issue.message}`,
            ),
          ),
        ...(options.meshReferences?.(candidate) ?? []),
      ],
      boneReferences: (id) => [
        ...animation
          .packageAnimations()
          .filter((clip) => Object.hasOwn(clip.tracks, id))
          .map((clip) => `animation "${clip.name}"`),
        ...animation.poseLibrary
          .packagePoses()
          .filter((pose) => Object.hasOwn(pose.bones, id))
          .map((pose) => `pose "${pose.name}"`),
        ...(options.boneReferences?.(id) ?? []),
      ],
      ikReferences: (id) => [
        ...animation
          .packageAnimations()
          .flatMap((clip) => [
            ...(clip.ikTracks && Object.hasOwn(clip.ikTracks, id) ? [`animation "${clip.name}" IK track`] : []),
            ...(clip.disabledIKConstraints?.includes(id) ? [`animation "${clip.name}" baked IK metadata`] : []),
          ]),
        ...(options.ikReferences?.(id) ?? []),
      ],
      defaultSkin: definition.defaultSkin,
      standaloneSkins: definition.standaloneSkins,
    }),
  };
}

/** Pure, transactional factory. It never reads or clones an existing character. */
export function createNewCharacter(options: NewCharacterOptions, existingIds: readonly string[] = []) {
  const identity = newCharacterSchema.parse(options);
  assertCharacterIdAvailable(identity.id, existingIds);
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: identity.id,
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skins/default.json' },
      animations: [],
      textures: {},
    },
    rig: { version: 1, name: identity.name, root: 'root', bones: [{ id: 'root' }] },
    skins: { 'skins/default.json': { version: 1, name: 'default', slots: {} } },
  });
  return { identity, definition, ...createCharacterDocuments(definition), unsaved: true as const };
}

const draftPrefix = 'paper-puppeteer:new-character:v1:';

/** Initial draft identities live in this browser tab; existing recovery owners retain authored edits. */
export class CharacterDraftStore {
  constructor(private readonly storage: Storage) {}

  choices(): { id: string; label: string }[] {
    const entries: { id: string; label: string }[] = [];
    for (let index = 0; index < this.storage.length; ++index) {
      const key = this.storage.key(index);
      if (!key?.startsWith(draftPrefix)) continue;
      const id = key.slice(draftPrefix.length);
      try {
        const identity = this.readIdentity(id);
        if (identity) entries.push({ id, label: `${identity.name} (draft)` });
      } catch {
        // An invalid or incompatible entry must not hide other drafts. Preserve its original bytes.
      }
    }
    return entries;
  }

  /** Listing identities must not allocate rigs, editor documents or histories. */
  private readIdentity(id: string): NewCharacterOptions | undefined {
    const json = this.storage.getItem(`${draftPrefix}${id}`);
    if (!json) return undefined;
    const options = newCharacterSchema.parse(JSON.parse(json));
    if (options.id !== id) throw new Error('Stored draft identity does not match its key.');
    assertCharacterIdAvailable(options.id);
    return options;
  }

  get(id: string) {
    const identity = this.readIdentity(id);
    return identity ? createNewCharacter(identity) : undefined;
  }

  create(options: NewCharacterOptions) {
    const workspace = createNewCharacter(options);
    // Invalid drafts still reserve their IDs so creation cannot overwrite retained recovery data.
    if (this.storage.getItem(`${draftPrefix}${workspace.identity.id}`) !== null)
      throw new Error(`Character ID "${workspace.identity.id}" already exists.`);
    // A single atomic storage write happens only after all validation and document initialization.
    this.storage.setItem(`${draftPrefix}${workspace.identity.id}`, JSON.stringify(workspace.identity));
    return workspace;
  }
}

export function browserCharacterDrafts(): CharacterDraftStore {
  return new CharacterDraftStore(window.sessionStorage);
}
