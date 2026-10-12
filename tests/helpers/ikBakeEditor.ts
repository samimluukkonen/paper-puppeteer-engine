import { vi } from 'vitest';
import { AnimationEditorState } from '../../src/devtools/animation-editor/AnimationEditorState.js';
import { IKBakeController } from '../../src/devtools/animation-editor/IKBakeController.js';
import { planIKBake } from '../../src/devtools/animation-editor/ikBakePlanning.js';
import type { AnimationClip } from '../../src/engine/AnimationClip.js';
import type { AnimationPose } from '../../src/engine/AnimationPose.js';
import type { TwoBoneIKConstraint } from '../../src/engine/ik/TwoBoneIKConstraint.js';
import { Rig } from '../../src/engine/Rig.js';

export function ikBakeEditor(runtime: () => readonly TwoBoneIKConstraint[] = () => []) {
  const rig = new Rig({
    root: 'body',
    bones: [
      { id: 'body' },
      { id: 'upper', parent: 'body' },
      { id: 'lower', parent: 'upper', y: 60 },
      { id: 'hand', parent: 'lower', y: 50 },
      { id: 'thigh', parent: 'body', x: -15 },
      { id: 'shin', parent: 'thigh', y: 70 },
      { id: 'foot', parent: 'shin', y: 60 },
    ],
    ik: [
      { name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' },
      { name: 'leg', rootBone: 'thigh', middleBone: 'shin', endBone: 'foot', bendDirection: -1 },
    ],
  });
  const source: AnimationClip = {
    name: 'reach',
    duration: 1000,
    loop: false,
    tracks: { upper: [{ time: 0, rotation: 0.2 }], lower: [{ time: 0, rotation: 0.1 }] },
    ikTracks: {
      arm: [
        { time: 0, x: 60, y: 60 },
        { time: 1000, x: -30, y: 75 },
      ],
      leg: [
        { time: 0, x: -25, y: 110 },
        { time: 1000, x: -45, y: 90 },
      ],
    },
    events: [{ time: 500, name: 'middle' }],
  };
  const state = new AnimationEditorState(rig, [source, { ...source, name: 'other' }]);
  state.selectAnimation('reach');
  const show = vi.fn<(pose: AnimationPose | null) => void>();
  const controller = new IKBakeController(show, runtime, (request) => ({
    result: Promise.resolve().then(() => planIKBake(structuredClone(request))),
    cancel() {},
  }));
  controller.bind(state);
  controller.setPanelOpen(true);
  return { rig, source, state, show, controller };
}

/** Wait for debounced planning without using timing thresholds for solver speed. */
export async function waitForIKBake(controller: IKBakeController): Promise<void> {
  await vi.waitFor(() => {
    if (controller.getSnapshot().pending) throw new Error('Bake is still being prepared.');
  });
}
