import Phaser from 'phaser';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { parseRigDefinition, type RigJsonDefinition } from '../../engine/externalData.js';
import { parseTwoBoneIKDefinition } from '../../engine/ik/TwoBoneIKConstraint.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import { Puppet } from '../../engine/Puppet.js';
import { loadSceneCharacter } from '../../shared/loadSceneCharacter.js';
import { RigEditor } from './RigEditor.js';
import { RigEditorState } from './RigEditorState.js';

export interface RigEditorSceneOptions {
  /** Manifest URL, resolved relative to the editor document. Defaults to the sample character. */
  readonly characterUrl?: string;
  /** Optional preview chains. Omit to edit rigs without requiring particular bone names. */
  readonly ikChains?: readonly TwoBoneIKDefinition[];
}

export class RigEditorScene extends Phaser.Scene {
  editor: RigEditor | undefined;
  private definition: CharacterDefinition | undefined;
  private puppet: Puppet | undefined;
  private loadedFilename: string | undefined;
  private loadSession = 0;
  private readonly characterUrl: string;
  private readonly ikChains: readonly TwoBoneIKDefinition[];

  get characterId(): string {
    return this.definition?.id ?? 'unknown';
  }
  get rigFilename(): string {
    return this.loadedFilename ?? this.definition?.rigPath?.split('/').at(-1) ?? 'rig.json';
  }

  constructor(
    private readonly onReady: (editor: RigEditor) => void,
    private readonly onError: (message: string) => void,
    options: RigEditorSceneOptions = {},
  ) {
    super('RigEditorScene');
    this.characterUrl = options.characterUrl ?? '../characters/demo-puppet/character.json';
    this.ikChains = structuredClone(options.ikChains ?? []);
  }

  create(): void {
    const session = ++this.loadSession;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ++this.loadSession;
      const editor = this.editor;
      const puppet = this.puppet;
      this.editor = undefined;
      this.puppet = undefined;
      this.definition = undefined;
      this.loadedFilename = undefined;
      try {
        editor?.disable();
      } finally {
        puppet?.destroy();
      }
    });
    void this.loadCharacter(session);
  }

  private async loadCharacter(session: number): Promise<void> {
    try {
      // Relative to the editor document, including when hosted under a Vite base path.
      const url = new URL(this.characterUrl, window.location.href).href;
      const definition = await loadSceneCharacter(this, url);
      if (!definition || session !== this.loadSession || !this.sys.isActive()) return;
      this.definition = definition;
      this.installRig(definition.rigFile!);
    } catch (error) {
      if (session === this.loadSession && this.sys.isActive()) this.onError(String(error));
    }
  }

  reloadRig(json: RigJsonDefinition, filename?: string): void {
    const previous = this.loadedFilename;
    if (filename) this.loadedFilename = filename;
    try {
      this.installRig(json);
    } catch (error) {
      this.loadedFilename = previous;
      throw error;
    }
  }

  reloadOriginal(): void {
    if (!this.definition?.rigFile) throw new Error('No original rig is loaded.');
    const previous = this.loadedFilename;
    this.loadedFilename = undefined;
    try {
      this.installRig(this.definition.rigFile);
    } catch (error) {
      this.loadedFilename = previous;
      throw error;
    }
  }

  private installRig(file: RigJsonDefinition): void {
    const definition = this.definition;
    if (!definition) throw new Error('No character is loaded.');
    // Skin files remain owned by the character manifest and are available to the preview.
    const rig = parseRigDefinition({ ...file, skins: file.skins ?? definition.rig.skins });
    if (!rig.skins.some((skin) => skin.name === definition.defaultSkin))
      throw new Error(`Rig needs the character's default skin "${definition.defaultSkin}" for preview.`);
    // A valid rig can still be incompatible with the editor's preview chains.
    const ikChains = this.ikChains.map((chain) => parseTwoBoneIKDefinition(chain, rig));
    const state = new RigEditorState(rig, file);
    const puppet = new Puppet(this, {
      rig: state.workingCopy,
      skin: definition.defaultSkin,
      x: 380,
      y: 435,
      autoUpdate: false,
    });
    let editor: RigEditor | undefined;
    try {
      editor = new RigEditor(this, puppet, () => this.onReady(this.editor!), state, ikChains);
      editor.enable();
    } catch (error) {
      try {
        editor?.disable();
      } finally {
        puppet.destroy();
      }
      throw error;
    }
    // Keep the working session alive until the replacement is fully initialized.
    this.editor?.disable();
    this.puppet?.destroy();
    this.puppet = puppet;
    this.editor = editor;
    this.onReady(editor);
  }
}
