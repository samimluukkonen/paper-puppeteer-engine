import { assert, test } from 'vitest';
import { getValidatedEditorAnimation } from '../src/devtools/animation-editor/validatedAnimation.js';
import { freezeData } from '../src/devtools/shared/editorData.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
const clip = (): AnimationClip => ({
  name: 'move',
  duration: 1000,
  loop: false,
  tracks: { root: [{ time: 0, x: 1 }] },
});

test('deeply frozen files share immutable validation results only for the same rig', () => {
  const animation = freezeData(clip());
  const parsed = getValidatedEditorAnimation(animation, rig);
  assert.strictEqual(getValidatedEditorAnimation(animation, rig), parsed);
  assert.isTrue(Object.isFrozen(parsed.tracks.root![0]));
  assert.throws(
    () => getValidatedEditorAnimation(animation, new Rig({ root: 'other', bones: [{ id: 'other' }] })),
    /unknown bone/i,
  );
});

test.each([false, true])('mutable nested files remain validated after every change, shallow freeze=%s', (shallow) => {
  const animation = clip();
  if (shallow) Object.freeze(animation);
  const parsed = getValidatedEditorAnimation(animation, rig);
  assert.isFalse(Object.isFrozen(animation.tracks.root![0]));
  (animation.tracks.root![0] as { x: number }).x = 7;
  assert.equal(getValidatedEditorAnimation(animation, rig).tracks.root![0]!.x, 7);
  assert.equal(parsed.tracks.root![0]!.x, 1);
  (animation.tracks.root![0] as { time: number }).time = 1001;
  assert.throws(() => getValidatedEditorAnimation(animation, rig), /duration/i);
  freezeData(animation);
  assert.throws(() => getValidatedEditorAnimation(animation, rig), /duration/i);
});
