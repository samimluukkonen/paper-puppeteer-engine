import Phaser from 'phaser';
import { demoIK } from '../../demo/demoIK.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { parseRigDefinition, type RigJsonDefinition } from '../../engine/externalData.js';
import { Puppet } from '../../engine/Puppet.js';
import { loadSceneCharacter } from '../../shared/loadSceneCharacter.js';
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
      const definition = await loadSceneCharacter(this, url);
      if (!definition || !this.sys.isActive()) return;
      this.definition = definition;
      this.installRig(definition.rigFile!);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.editor?.disable();
        this.puppet?.destroy();
      });
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
    // A valid rig can still be incompatible with the editor's preview chains.
    for (const chain of demoIK) {
      const root = rig.getBone(chain.rootBone);
      const middle = rig.getBone(chain.middleBone);
      const end = rig.getBone(chain.endBone);
      if (middle.parent !== root.id || end.parent !== middle.id)
        throw new Error(`IK "${chain.name}" must name three directly connected bones.`);
    }
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
      editor = new RigEditor(this, puppet, () => this.onReady(this.editor!), state, demoIK);
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
