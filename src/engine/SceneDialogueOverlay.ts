import type Phaser from 'phaser';
import { cinematicFrame, DEFAULT_CINEMATIC_CAMERA, type CinematicCameraState } from './cinematicCamera.js';
import type { ActiveSceneDialogue, SceneDialogueTarget } from './sceneDialogue.js';

/** Output-space subtitles above cinematic fades (8000), below editor guides (9000).
 * Local coordinates are 1000×700 output pixels; inverse authored zoom keeps text
 * stable through pans, zooms and host letterboxing. No React, timers or cue listeners.
 */
export class SceneDialogueOverlay implements SceneDialogueTarget {
  private root: Phaser.GameObjects.Container | undefined;
  private readonly backing: Phaser.GameObjects.Graphics;
  private readonly speaker: Phaser.GameObjects.Text;
  private readonly text: Phaser.GameObjects.Text;
  private label = '';
  private content = '';

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container().setDepth(8500).setName('scene-dialogue').setVisible(false);
    try {
      this.backing = scene.add.graphics();
      this.root.add(this.backing);
      const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      this.speaker = scene.add
        .text(0, 0, '', {
          fontFamily,
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#ffffff',
          wordWrap: { width: 864, useAdvancedWrap: true },
          maxLines: 2,
        })
        .setName('scene-dialogue-speaker');
      this.root.add(this.speaker);
      this.text = scene.add
        .text(0, 0, '', {
          fontFamily,
          fontSize: '26px',
          color: '#ffffff',
          lineSpacing: 6,
          wordWrap: { width: 864, useAdvancedWrap: true },
          maxLines: 12,
        })
        .setName('scene-dialogue-text');
      this.root.add(this.text);
      this.setCamera(DEFAULT_CINEMATIC_CAMERA);
      scene.events.once('shutdown', this.dispose);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  setCamera(camera: Readonly<CinematicCameraState>): void {
    if (!this.root) return;
    const frame = cinematicFrame(camera);
    this.root.setPosition(frame.x, frame.y).setScale(1 / camera.zoom);
  }

  setDialogue(dialogue: ActiveSceneDialogue | undefined): void {
    const root = this.root;
    if (!root) return;
    const label = dialogue?.speaker ?? '';
    const content = dialogue?.line.text ?? '';
    root.setVisible(!!content);
    if (label === this.label && content === this.content) return;
    this.label = label;
    this.content = content;
    this.speaker.setText(label).setVisible(!!label);
    this.text.setText(content);
    // Keep even unusually large multiline content inside the output safe area.
    const speakerHeight = label ? this.speaker.height + 8 : 0;
    const height = speakerHeight + this.text.height;
    const fit = Math.min(1, 520 / Math.max(1, height));
    this.speaker.setScale(fit);
    this.text.setScale(fit);
    const top = 700 - 36 - height * fit - 40;
    this.speaker.setPosition(68, top + 20);
    this.text.setPosition(68, top + 20 + speakerHeight * fit);
    this.backing.clear();
    if (content) this.backing.fillStyle(0x010409, 0.82).fillRoundedRect(48, top, 904, height * fit + 40, 8);
  }

  readonly dispose = (): void => {
    this.scene.events.off('shutdown', this.dispose);
    this.root?.destroy();
    this.root = undefined;
  };
}
