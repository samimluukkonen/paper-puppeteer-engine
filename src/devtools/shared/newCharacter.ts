import { z } from 'zod';
import { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { Rig } from '../../engine/Rig.js';
import { characterCatalog } from '../../shared/characterCatalog.js';
import { AnimationEditorState } from '../animation-editor/AnimationEditorState.js';
import { RigEditorState, type RigEditorStateOptions } from '../rig-editor/RigEditorState.js';

const newCharacterSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a character name.')
    .max(100)
    .refine(
      (value) => value.split('').every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
      'Names cannot contain control characters.',
    ),
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens between words.'),
});
export type NewCharacterOptions = z.infer<typeof newCharacterSchema>;
export type CharacterWorkspace = ReturnType<typeof createNewCharacter>;

export function suggestCharacterId(name: string, existingIds: readonly string[] = []): string {
  const stem =
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 56)
      .replace(/-$/, '') || 'character';
  const used = new Set(existingIds.map((id) => id.toLowerCase()));
  let id = stem;
  let suffix = 1;
  while (used.has(id)) id = `${stem}-${++suffix}`;
  return id;
}

/** One owner per editing domain, used by both loaded characters and new drafts. */
export function createCharacterDocuments(definition: CharacterDefinition, options: RigEditorStateOptions = {}) {
  const file = definition.rigFile;
  const animation = new AnimationEditorState(definition.rig, definition.animations, {
    animationPaths: definition.animationPaths,
  });
  return {
    animation,
    rig: new RigEditorState(new Rig(definition.rig, file?.skins ?? []), file, {
      ...options,
      boneReferences: (id) => [
        ...animation
          .packageAnimations()
          .filter((clip) => Object.hasOwn(clip.tracks, id))
          .map((clip) => `animation "${clip.name}"`),
        ...definition.poses.filter((pose) => Object.hasOwn(pose.bones, id)).map((pose) => `pose "${pose.name}"`),
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
  if ([...characterCatalog.map((entry) => entry.id), ...existingIds].some((id) => id.toLowerCase() === identity.id))
    throw new Error(`Character ID "${identity.id}" already exists.`);
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
        const draft = this.get(id);
        if (draft) entries.push({ id, label: `${draft.identity.name} (draft)` });
      } catch {
        // An invalid or incompatible entry must not hide other drafts. Preserve its original bytes.
      }
    }
    return entries;
  }

  get(id: string) {
    const json = this.storage.getItem(`${draftPrefix}${id}`);
    if (!json) return undefined;
    const options = newCharacterSchema.parse(JSON.parse(json));
    if (options.id !== id) throw new Error('Stored draft identity does not match its key.');
    return createNewCharacter(options);
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
