import type Phaser from 'phaser';
import { isTypingTarget } from '../shared/keyboardShortcuts.js';
import type { DemoPoseAuthoring } from './DemoPoseAuthoring.js';
import type { DemoPresenter } from './DemoPresenter.js';
import type { DemoScene } from './DemoScene.js';
import { createDemoCommands } from './demoCommands.js';

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
      const commands = new Map(
        Object.values(createDemoCommands(scene)).flatMap((command) =>
          command.code ? [[command.code, command] as const] : [],
        ),
      );
      const onKeyDown = (event: KeyboardEvent): void => {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          isTypingTarget(event.target)
        )
          return;
        const command = commands.get(event.code);
        if (command) {
          if (
            event.altKey ||
            (event.code === 'Space' && (event.target as Element | null)?.closest?.('button, a[href]'))
          )
            return;
          event.preventDefault();
          if (!event.repeat) command.runFromKeyboard(authoring.active);
          return;
        }
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
      // Handle DOM events before the browser's default action; Phaser dispatches its queue later.
      window.addEventListener('keydown', onKeyDown);
      this.cleanup.push(() => window.removeEventListener('keydown', onKeyDown));
      this.rotateLeft = keyboard.addKey('Q', false);
      this.rotateRight = keyboard.addKey('E', false);
    }
    scene.events.once('shutdown', () => {
      for (const cleanup of this.cleanup) cleanup();
      this.cleanup.length = 0;
    });
  }

  katanaTurn(delta: number): number {
    if (!this.rotateLeft?.isDown && !this.rotateRight?.isDown) return 0;
    if (isTypingTarget(document.activeElement)) return 0;
    const held = (key: Phaser.Input.Keyboard.Key | undefined): boolean => {
      const event = key?.originalEvent;
      return (
        !!key?.isDown &&
        !key.altKey &&
        !key.ctrlKey &&
        !key.metaKey &&
        !event?.isComposing &&
        !event?.defaultPrevented &&
        !isTypingTarget(event?.target ?? null)
      );
    };
    const turn = Number(held(this.rotateRight)) - Number(held(this.rotateLeft));
    return (turn * delta) / 1000;
  }
}
