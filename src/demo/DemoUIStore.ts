import { createDemoCommands, type DemoCommand } from './demoCommands.js';
import type { DemoScene, DemoState } from './DemoScene.js';

/** Cached UI snapshots keep unchanged controls out of React's render work during a crossfade. */
export class DemoUIStore {
  private readonly listeners = new Set<() => void>();
  private commands: Readonly<Record<string, DemoCommand>> = {};
  private pressed: Readonly<Record<string, boolean>> = { idle: true, walk: false, right: true, left: false };
  private status = 'Loading character…';
  private stopped = false;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getStatus = (): string => this.status;
  readonly isStopped = (): boolean => this.stopped;
  isPressed(action: string): boolean | undefined {
    return this.pressed[action];
  }
  run(action: string): void {
    this.commands[action]?.run();
  }
  bind(scene: DemoScene): () => void {
    this.commands = createDemoCommands(scene);
    return () => {
      this.commands = {};
    };
  }
  readonly update = (state: DemoState): void => {
    const pressed = {
      idle: state.animationRole === 'idle',
      walk: state.animationRole === 'walk',
      sword: state.animationRole === 'sword',
      left: state.facing === 'left',
      right: state.facing === 'right',
      debug: state.debug,
      prop: state.katanaVisible,
      handIK: state.handIK,
      footIK: state.footIK,
      ikDebug: state.ikDebug,
      stepped: state.playback === 'stepped',
      upperBody: state.upperBody,
      pause: state.paused,
      defaultSkin: state.skin === 'default',
      armoredSkin: state.skin === 'alternate',
      gripHand: state.gripHand,
      helmet: state.helmet,
      slotDebug: state.slotDebug,
      poseMode: state.poseMode,
    };
    const status = `Current: ${state.animation}${state.playing ? '' : ' (stopped)'}\nPlayback: ${state.playback}${state.playback === 'stepped' ? ` ${state.fps} FPS` : ''} · ${state.speed.toFixed(2)}x\nPaused: ${state.paused} · Upper body: ${state.upperBody ? `on (${state.layerWeight.toFixed(1)})` : 'off'}\nTransition: ${state.transition}\nEvent: ${state.lastEvent}`;
    const changed =
      status !== this.status || Object.entries(pressed).some(([key, value]) => value !== this.pressed[key]);
    this.pressed = pressed;
    this.status = status;
    this.stopped = !state.playing;
    if (changed) for (const listener of this.listeners) listener();
  };
}
