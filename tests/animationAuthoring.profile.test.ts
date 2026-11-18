import { test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { setBonePropertyKeyframes } from '../src/devtools/animation-editor/keyframes.js';
import { freezeData } from '../src/engine/readonlyData.js';
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
      state.keyframes.setBonePropertyKeyframe('b0', 'x', i, 1);
      state.getEvaluatedBoneTransform('b0');
    }
    return (performance.now() - start) / count;
  };
  run(5);
  const values = Array.from({ length: 5 }, () => run(10)).sort((a, b) => a - b);
  console.log('Dense authoring median ms/edit:', values[2]);
});

test.skipIf(import.meta.env.VITE_PROFILE !== '1')('dense bulk property edits', { timeout: 30000 }, () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  for (const count of [1000, 2000]) {
    const source = freezeData({
      name: 'bulk',
      duration: count * 10,
      loop: false,
      tracks: { root: Array.from({ length: count }, (_, i) => ({ time: i * 10, x: i })) },
    });
    const edits = Array.from({ length: count }, (_, i) => ({
      boneId: 'root',
      property: 'y' as const,
      timeMs: i * 10 + 1,
      value: i,
    }));
    setBonePropertyKeyframes(source, rig, edits);
    const values = Array.from({ length: 5 }, () => {
      const start = performance.now();
      setBonePropertyKeyframes(source, rig, edits);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    console.log(`${count} bulk keys median ms:`, values[2]);
  }
});
