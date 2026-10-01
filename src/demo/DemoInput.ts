import type Phaser from 'phaser';
import type { DemoPoseAuthoring } from './DemoPoseAuthoring.js';
import type { DemoPresenter } from './DemoPresenter.js';
import type { DemoScene } from './DemoScene.js';

/** Scene input bindings and held weapon-rotation keys. */
export class DemoInput {
  private rotateLeft: Phaser.Input.Keyboard.Key | undefined;
  private rotateRight: Phaser.Input.Keyboard.Key | undefined;
  private readonly cleanup: (() => void)[] = [];

  constructor(scene: DemoScene, authoring: DemoPoseAuthoring, presentation: DemoPresenter) {
    const onPointerMove = (pointer: Phaser.Input.Pointer): void => {
      presentation.handTarget = { x: pointer.worldX, y: pointer.worldY };
    };
    scene.input.on('pointermove', onPointerMove);
    this.cleanup.push(() => scene.input.off('pointermove', onPointerMove));
    const keyboard = scene.input.keyboard;
    if (keyboard) {
      const on = (event: string, handler: () => void): void => {
        keyboard.on(event, handler);
        this.cleanup.push(() => keyboard.off(event, handler));
      };
      on('keydown-ONE', () => scene.play('idle'));
      on('keydown-TWO', () => scene.play('walk'));
      on('keydown-THREE', () => scene.play('sword'));
      on('keydown-FOUR', () => scene.crossfade('idle'));
      on('keydown-FIVE', () => scene.crossfade('walk'));
      on('keydown-S', () => scene.toggleStepped());
      on('keydown-EIGHT', () => scene.setSteppedFPS(8));
      on('keydown-ZERO', () => scene.setSteppedFPS(10));
      on('keydown-L', () => scene.toggleUpperBody());
      on('keydown-P', () => scene.togglePause());
      on('keydown-OPEN_BRACKET', () => (authoring.active ? scene.selectBone(-1) : scene.adjustSpeed(-0.25)));
      on('keydown-CLOSED_BRACKET', () => (authoring.active ? scene.selectBone(1) : scene.adjustSpeed(0.25)));
      on('keydown-A', () => scene.face('left'));
      on('keydown-D', () => scene.face('right'));
      on('keydown-B', () => scene.toggleDebug());
      on('keydown-I', () => scene.toggleIKDebug());
      on('keydown-F', () => scene.toggleFootIK());
      on('keydown-H', () => scene.toggleHandIK());
      on('keydown-T', () => scene.toggleProp());
      on('keydown-K', () => scene.setSkin('default'));
      on('keydown-M', () => scene.setSkin('alternate'));
      on('keydown-G', () => scene.toggleGripHand());
      on('keydown-N', () => scene.toggleHelmet());
      on('keydown-V', () => scene.toggleSlotDebug());
      on('keydown-SPACE', () => scene.togglePlayback());
      on('keydown-R', () => (authoring.active ? scene.resetBind() : scene.restart()));
      on('keydown-O', () => scene.togglePoseMode());
      on('keydown-C', () => scene.applyCombatPose());
      on('keydown-X', () => scene.exportCurrentPose());
      on('keydown-J', () => scene.exportRig());
      on('keydown-U', () => scene.resetSelectedBone());
      const onKeyDown = (event: KeyboardEvent): void => {
        if (!authoring.active || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? 0.1 : 0.01;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const sign = event.key === 'ArrowRight' ? 1 : -1;
          scene.adjustSelected(
            event.altKey ? 'x' : 'rotation',
            sign * (event.altKey ? (event.shiftKey ? 5 : 1) : step),
          );
        } else scene.adjustSelected('y', (event.key === 'ArrowDown' ? 1 : -1) * (event.shiftKey ? 5 : 1));
      };
      keyboard.on('keydown', onKeyDown);
      this.cleanup.push(() => keyboard.off('keydown', onKeyDown));
      keyboard.addCapture(['SPACE']);
      this.rotateLeft = keyboard.addKey('Q');
      this.rotateRight = keyboard.addKey('E');
    }
    scene.events.once('shutdown', () => {
      for (const cleanup of this.cleanup) cleanup();
      this.cleanup.length = 0;
    });
  }

  katanaTurn(delta: number): number {
    const turn = Number(this.rotateRight?.isDown ?? false) - Number(this.rotateLeft?.isDown ?? false);
    return (turn * delta) / 1000;
  }
}
