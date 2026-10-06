import { type AnimationClip, type CompiledClip, compileClip } from '../../engine/AnimationClip.js';
import { ANIMATION_FORMAT_VERSION, parseAnimationClip } from '../../engine/externalData.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { isFullyFrozen } from '../shared/editorData.js';

type AnimationData = DeepReadonly<AnimationClip>;
const clips = new WeakMap<AnimationData, WeakMap<Rig, CompiledClip>>();

/** Inspector and canvas share immutable compilation; each consumer retains its own pose buffers. */
export function getCompiledPreviewClip(animation: AnimationData, rig: Rig): CompiledClip {
  const cached = clips.get(animation)?.get(rig);
  if (cached) return cached;
  const parsed = parseAnimationClip({ version: ANIMATION_FORMAT_VERSION, ...animation }, rig);
  // The editor clock owns looping and endpoints; previews never dispatch gameplay events.
  const clip = compileClip({ ...parsed, loop: false, events: [] }, rig);
  if (isFullyFrozen(animation)) {
    let rigs = clips.get(animation);
    if (!rigs) {
      rigs = new WeakMap();
      clips.set(animation, rigs);
    }
    rigs.set(rig, clip);
  }
  return clip;
}
