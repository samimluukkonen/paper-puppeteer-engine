import type { DemoScene } from './DemoScene.js';

export interface DemoCommand {
  readonly code?: string;
  readonly run: () => void;
  readonly runFromKeyboard: (poseMode: boolean) => void;
}

function command(run: () => void, code?: string, runInPoseMode?: () => void): DemoCommand {
  return {
    ...(code === undefined ? {} : { code }),
    run,
    runFromKeyboard: (poseMode) => (poseMode && runInPoseMode ? runInPoseMode : run)(),
  };
}

/** Scene-owned commands shared by DOM buttons and keyboard bindings. Held Q/E rotation stays in DemoInput. */
export function createDemoCommands(scene: DemoScene): Readonly<Record<string, DemoCommand>> {
  return {
    idle: command(() => scene.play('idle'), 'Digit1'),
    walk: command(() => scene.play('walk'), 'Digit2'),
    sword: command(() => scene.play('sword'), 'Digit3'),
    fadeIdle: command(() => scene.crossfade('idle'), 'Digit4'),
    fadeWalk: command(() => scene.crossfade('walk'), 'Digit5'),
    stepped: command(() => scene.toggleStepped(), 'KeyS'),
    fps8: command(() => scene.setSteppedFPS(8), 'Digit8'),
    fps10: command(() => scene.setSteppedFPS(10), 'Digit0'),
    pause: command(() => scene.togglePause(), 'KeyP'),
    slower: command(
      () => scene.adjustSpeed(-0.25),
      'BracketLeft',
      () => scene.selectBone(-1),
    ),
    faster: command(
      () => scene.adjustSpeed(0.25),
      'BracketRight',
      () => scene.selectBone(1),
    ),
    upperBody: command(() => scene.toggleUpperBody(), 'KeyL'),
    left: command(() => scene.face('left'), 'KeyA'),
    right: command(() => scene.face('right'), 'KeyD'),
    debug: command(() => scene.toggleDebug(), 'KeyB'),
    prop: command(() => scene.toggleProp(), 'KeyT'),
    handIK: command(() => scene.toggleHandIK(), 'KeyH'),
    footIK: command(() => scene.toggleFootIK(), 'KeyF'),
    ikDebug: command(() => scene.toggleIKDebug(), 'KeyI'),
    defaultSkin: command(() => scene.setSkin('default'), 'KeyK'),
    armoredSkin: command(() => scene.setSkin('alternate'), 'KeyM'),
    gripHand: command(() => scene.toggleGripHand(), 'KeyG'),
    helmet: command(() => scene.toggleHelmet(), 'KeyN'),
    slotDebug: command(() => scene.toggleSlotDebug(), 'KeyV'),
    rotateLeft: command(() => scene.rotateKatana(-0.15)),
    rotateRight: command(() => scene.rotateKatana(0.15)),
    poseMode: command(() => scene.togglePoseMode(), 'KeyO'),
    combatPose: command(() => scene.applyCombatPose(), 'KeyC'),
    bindPose: command(() => scene.resetBind()),
    exportPose: command(() => scene.exportCurrentPose(), 'KeyX'),
    exportRig: command(() => scene.exportRig(), 'KeyJ'),
    resetBone: command(() => scene.resetSelectedBone(), 'KeyU'),
    playback: command(() => scene.togglePlayback(), 'Space'),
    restart: command(
      () => scene.restart(),
      'KeyR',
      () => scene.resetBind(),
    ),
  };
}
