import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  DEFAULT_GRAPH_CURVE,
  fitGraph,
  graphDisplayKeys,
  panGraph,
  sampleGraph,
  zoomGraph,
} from '../src/devtools/animation-editor/graphEditor.js';
import { MotionDiagnosticsController } from '../src/devtools/animation-editor/MotionDiagnosticsController.js';
import { PoseLibraryController } from '../src/devtools/animation-editor/PoseLibraryController.js';
import { Rig } from '../src/engine/Rig.js';

// Local CPU observations, never timing gates. Browser layout/rendering is measured separately.
test.skipIf(import.meta.env.VITE_PROFILE !== '1')(
  'advanced authoring: dense curves and 250 full poses',
  { timeout: 120000 },
  () => {
    const rig = new Rig({
      root: 'root',
      bones: [{ id: 'root' }, ...Array.from({ length: 32 }, (_, i) => ({ id: `b${i}`, parent: 'root' }))],
    });
    const source = {
      name: 'dense',
      duration: 1270,
      loop: true,
      tracks: Object.fromEntries(
        rig.bones.map(({ id }) => [id, Array.from({ length: 128 }, (_, i) => ({ time: i * 10, x: i, y: -i }))]),
      ),
    };
    const state = new AnimationEditorState(rig, [source, { ...source, name: 'other' }], {
      poses: Array.from({ length: 250 }, (_, i) => ({
        version: 1,
        name: `Pose ${i}`,
        bones: Object.fromEntries(rig.bones.map(({ id }) => [id, { x: i }])),
      })),
    });
    state.selectAnimation('dense');
    const library = new PoseLibraryController();
    const diagnostics = new MotionDiagnosticsController();
    library.bind(state);
    diagnostics.bind(state);
    const measure = (name: string, count: number, action: (i: number) => void) => {
      for (let i = 0; i < Math.min(5, count); i++) action(i);
      const samples = Array.from({ length: 5 }, () => {
        const start = performance.now();
        for (let i = 0; i < count; i++) action(i);
        return (performance.now() - start) / count;
      }).sort((a, b) => a - b);
      console.log(`${name} median ms/operation: ${samples[2]!.toFixed(4)}`);
    };
    measure('clock notification with 250 poses', 120, (i) => state.setCurrentTime((i % 120) / 100));
    measure('browse/search 250 poses + compatibility', 20, (i) => {
      const matches = state.poseLibrary.poses.filter(({ pose }) => pose.name.includes(String(i)));
      for (const entry of matches) state.poseLibrary.compatibility(entry.id, rig);
    });
    const channel = { kind: 'bone', id: 'b0', property: 'x' } as const;
    measure('graph zoom/pan + 641 runtime curve samples', 20, (i) => {
      const keys = graphDisplayKeys(state.workingAnimation!, channel);
      const view = panGraph(zoomGraph(fitGraph(state.workingAnimation!, channel), 0.8, 0.6, 64), i / 1000, 0);
      for (let pixel = 0; pixel <= 640; pixel++)
        sampleGraph(state.workingAnimation!, keys, view.start + (pixel / 640) * (view.end - view.start));
    });
    const ref = { channel, time: 0 };
    state.beginGraphEdit(ref);
    measure('validated curve drag proposal', 10, (i) =>
      state.previewGraphEdit({ curve: { ...DEFAULT_GRAPH_CURVE, control1: { x: 0.2, y: i / 20 } } }),
    );
    state.cancelGraphEdit();
    measure('animation switching', 10, (i) => {
      state.selectAnimation(i % 2 ? 'dense' : 'other', { keepChanges: true });
    });
    measure('manual diagnostics (8448 property keys)', 1, () => {
      assert.isTrue(diagnostics.run());
    });
    state.play();
    measure('timeline clock update with tools bound', 120, () => state.advancePlayback(1 / 60));
    state.pause();
    diagnostics.dispose();
    library.dispose();
  },
);
