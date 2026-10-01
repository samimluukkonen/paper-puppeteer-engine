import Phaser from 'phaser';
import { demoIK } from '../../demo/demoIK.js';
import { CharacterLoader } from '../../engine/CharacterLoader.js';
import { Puppet } from '../../engine/Puppet.js';
import { queueCharacterTextures } from '../../engine/queueCharacterTextures.js';
import { RigEditor } from './RigEditor.js';
import { RigEditorState } from './RigEditorState.js';

export class RigEditorScene extends Phaser.Scene {
  editor: RigEditor | undefined;

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
          const state = new RigEditorState(definition.rig);
          const puppet = new Puppet(this, {
            rig: state.workingCopy,
            skin: definition.defaultSkin,
            x: 380,
            y: 435,
            autoUpdate: false,
          });
          this.editor = new RigEditor(this, puppet, () => this.onReady(this.editor!), state, demoIK);
          this.editor.enable();
          this.onReady(this.editor);
          this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.editor?.disable());
        } catch (error) {
          this.onError(String(error));
        }
      });
      this.load.start();
    } catch (error) {
      this.onError(String(error));
    }
  }
}
