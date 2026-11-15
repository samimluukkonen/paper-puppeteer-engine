import { compileValidatedClip, type AnimationClip, type CompiledClip } from '../../engine/core.js';
import type { DeepReadonly, Rig } from '../../engine/data.js';
import { getValidatedEditorAnimation } from './validatedAnimation.js';

type AnimationData = DeepReadonly<AnimationClip>;
const clips = new WeakMap<AnimationData, WeakMap<Rig, CompiledClip>>();

/** Inspector and canvas share immutable compilation; each consumer retains its own pose buffers. */
export function getCompiledPreviewClip(animation: AnimationData, rig: Rig): CompiledClip {
  const cached = clips.get(animation)?.get(rig);
  if (cached) return cached;
  const parsed = getValidatedEditorAnimation(animation, rig);
  // The editor clock owns looping and endpoints; previews never dispatch gameplay events.
  const clip = compileValidatedClip({ ...parsed, loop: false, events: [] });
  if (parsed === animation) {
    let rigs = clips.get(animation);
    if (!rigs) {
      rigs = new WeakMap();
      clips.set(animation, rigs);
    }
    rigs.set(rig, clip);
  }
  return clip;
}
