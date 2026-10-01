import Phaser from 'phaser';
import { demoIK } from '../../demo/demoIK.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { CharacterLoader } from '../../engine/CharacterLoader.js';
import { parseRigDefinition, type RigJsonDefinition } from '../../engine/externalData.js';
import { Puppet } from '../../engine/Puppet.js';
import { queueCharacterTextures } from '../../engine/queueCharacterTextures.js';
import { RigEditor } from './RigEditor.js';
import { RigEditorState } from './RigEditorState.js';

export class RigEditorScene extends Phaser.Scene {
  editor: RigEditor | undefined;
  private definition: CharacterDefinition | undefined;
  private puppet: Puppet | undefined;
  private loadedFilename: string | undefined;

  get characterId(): string {
    return this.definition?.id ?? 'unknown';
  }
  get rigFilename(): string {
    return this.loadedFilename ?? this.definition?.rigPath?.split('/').at(-1) ?? 'rig.json';
  }

  constructor(
    private readonly onReady: (editor: RigEditor) => void,
    private readonly onError: (message: string) => void,
  ) {
    super('RigEditorScene');
  }

  create(): void {
    void this.loadCharacter();
  }

  private async loadCharacter(): Promise<void> {
    try {
      // Relative to the editor document, including when hosted under a Vite base path.
      const url = new URL('../characters/demo-puppet/character.json', window.location.href).href;
      const definition = await CharacterLoader.load(url);
      this.definition = definition;
      if (!this.sys.isActive()) return;
      queueCharacterTextures(this, definition);
      let failed = false;
      const onError = (): void => {
        failed = true;
      };
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
        if (!this.sys.isActive()) return;
        if (failed) {
          this.onError('One or more character images could not be loaded.');
          return;
        }
        try {
          this.installRig(definition.rigFile!);
          this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.editor?.disable();
            this.puppet?.destroy();
          });
        } catch (error) {
          this.onError(String(error));
        }
      });
      this.load.start();
    } catch (error) {
      this.onError(String(error));
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
    const state = new RigEditorState(rig, file);
    const puppet = new Puppet(this, {
      rig: state.workingCopy,
      skin: definition.defaultSkin,
      x: 380,
      y: 435,
      autoUpdate: false,
    });
    this.editor?.disable();
    this.puppet?.destroy();
    this.puppet = puppet;
    this.editor = new RigEditor(this, puppet, () => this.onReady(this.editor!), state, demoIK);
    this.editor.enable();
    this.onReady(this.editor);
  }
}
