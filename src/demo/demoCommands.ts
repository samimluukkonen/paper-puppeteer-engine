import type { DemoScene } from './DemoScene.js';

export interface DemoCommand {
  readonly key?: string;
  readonly run: () => void;
  readonly runFromKeyboard: (poseMode: boolean) => void;
}

function command(run: () => void, key?: string, runInPoseMode?: () => void): DemoCommand {
  return {
    ...(key === undefined ? {} : { key }),
    run,
    runFromKeyboard: (poseMode) => (poseMode && runInPoseMode ? runInPoseMode : run)(),
  };
}

/** Scene-owned commands shared by DOM buttons and keyboard bindings. Held Q/E rotation stays in DemoInput. */
export function createDemoCommands(scene: DemoScene): Readonly<Record<string, DemoCommand>> {
  return {
    idle: command(() => scene.play('idle'), 'ONE'),
    walk: command(() => scene.play('walk'), 'TWO'),
    sword: command(() => scene.play('sword'), 'THREE'),
    fadeIdle: command(() => scene.crossfade('idle'), 'FOUR'),
    fadeWalk: command(() => scene.crossfade('walk'), 'FIVE'),
    stepped: command(() => scene.toggleStepped(), 'S'),
    fps8: command(() => scene.setSteppedFPS(8), 'EIGHT'),
    fps10: command(() => scene.setSteppedFPS(10), 'ZERO'),
    pause: command(() => scene.togglePause(), 'P'),
    slower: command(
      () => scene.adjustSpeed(-0.25),
      'OPEN_BRACKET',
      () => scene.selectBone(-1),
    ),
    faster: command(
      () => scene.adjustSpeed(0.25),
      'CLOSED_BRACKET',
      () => scene.selectBone(1),
    ),
    upperBody: command(() => scene.toggleUpperBody(), 'L'),
    left: command(() => scene.face('left'), 'A'),
    right: command(() => scene.face('right'), 'D'),
    debug: command(() => scene.toggleDebug(), 'B'),
    prop: command(() => scene.toggleProp(), 'T'),
    handIK: command(() => scene.toggleHandIK(), 'H'),
    footIK: command(() => scene.toggleFootIK(), 'F'),
    ikDebug: command(() => scene.toggleIKDebug(), 'I'),
    defaultSkin: command(() => scene.setSkin('default'), 'K'),
    armoredSkin: command(() => scene.setSkin('alternate'), 'M'),
    gripHand: command(() => scene.toggleGripHand(), 'G'),
    helmet: command(() => scene.toggleHelmet(), 'N'),
    slotDebug: command(() => scene.toggleSlotDebug(), 'V'),
    rotateLeft: command(() => scene.rotateKatana(-0.15)),
    rotateRight: command(() => scene.rotateKatana(0.15)),
    poseMode: command(() => scene.togglePoseMode(), 'O'),
    combatPose: command(() => scene.applyCombatPose(), 'C'),
    bindPose: command(() => scene.resetBind()),
    exportPose: command(() => scene.exportCurrentPose(), 'X'),
    exportRig: command(() => scene.exportRig(), 'J'),
    resetBone: command(() => scene.resetSelectedBone(), 'U'),
    playback: command(() => scene.togglePlayback(), 'SPACE'),
    restart: command(
      () => scene.restart(),
      'R',
      () => scene.resetBind(),
    ),
  };
}
