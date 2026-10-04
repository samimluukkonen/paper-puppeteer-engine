import Phaser from 'phaser';
import { Puppet } from '../../engine/Puppet.js';
import { loadSceneCharacter } from '../../shared/loadSceneCharacter.js';
import { AnimationEditorPreview } from './AnimationEditorPreview.js';
import { AnimationEditorState } from './AnimationEditorState.js';

export interface AnimationEditorSceneOptions {
  /** Resolved relative to the editor document, including when served under a base path. */
  readonly characterUrl?: string;
}

export class AnimationEditorScene extends Phaser.Scene {
  private puppet: Puppet | undefined;
  private preview: AnimationEditorPreview | undefined;
  private loadSession = 0;

  constructor(
    private readonly onReady: (state: AnimationEditorState, characterId: string) => void,
    private readonly onError: (message: string) => void,
    private readonly options: AnimationEditorSceneOptions = {},
  ) {
    super('AnimationEditorScene');
  }

  create(): void {
    const session = ++this.loadSession;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ++this.loadSession;
      this.preview?.dispose();
      this.preview = undefined;
      this.puppet?.destroy();
      this.puppet = undefined;
    });
    void this.loadCharacter(session);
  }

  private async loadCharacter(session: number): Promise<void> {
    let puppet: Puppet | undefined;
    let preview: AnimationEditorPreview | undefined;
    try {
      const url = new URL(
        this.options.characterUrl ?? '../characters/demo-puppet/character.json',
        window.location.href,
      );
      const definition = await loadSceneCharacter(this, url.href);
      if (!definition || session !== this.loadSession || !this.sys.isActive()) return;
      const state = new AnimationEditorState(definition.rig, definition.animations);
      state.selectAnimation(state.animationIds[0] ?? null);
      puppet = new Puppet(this, {
        rig: definition.rig,
        skin: definition.defaultSkin,
        x: 380,
        y: 435,
        autoUpdate: false,
      });
      preview = new AnimationEditorPreview(state, puppet);
      this.puppet = puppet;
      this.preview = preview;
      this.onReady(state, definition.id);
    } catch (error) {
      preview?.dispose();
      puppet?.destroy();
      this.preview = undefined;
      this.puppet = undefined;
      if (session === this.loadSession && this.sys.isActive()) this.onError(String(error));
    }
  }
}
