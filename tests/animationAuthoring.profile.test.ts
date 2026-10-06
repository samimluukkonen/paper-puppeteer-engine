import { test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { Rig } from '../src/engine/Rig.js';
// Diagnostic CPU profile; no timing threshold. Run with VITE_PROFILE=1 and --reporter=verbose.
test.skipIf(import.meta.env.VITE_PROFILE !== '1')('33 bones, 512 keys: edit and sample', { timeout: 30000 }, () => {
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, ...Array.from({ length: 32 }, (_, i) => ({ id: 'b' + i, parent: 'root' }))],
  });
  const tracks = Object.fromEntries(
    rig.bones.map((b) => [b.id, Array.from({ length: 512 }, (_, i) => ({ time: i * 10, x: i, y: -i }))]),
  );
  const state = new AnimationEditorState(rig, [{ name: 'dense', duration: 5120, loop: false, tracks }]);
  state.selectAnimation('dense');
  state.selectBone('b0');
  const run = (count: number) => {
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      state.setBonePropertyKeyframe('b0', 'x', i, 1);
      state.getEvaluatedBoneTransform('b0');
    }
    return (performance.now() - start) / count;
  };
  run(5);
  const values = Array.from({ length: 5 }, () => run(10)).sort((a, b) => a - b);
  console.log('Dense authoring median ms/edit:', values[2]);
});
