import type { AnimationClip, Keyframe } from './AnimationClip.js';

const emptyTrack: readonly Keyframe[] = Object.freeze([]);

/** Sparse bone tracks never inherit rows from the dictionary's prototype. */
export function getBoneTrack(animation: Pick<AnimationClip, 'tracks'>, boneId: string): readonly Keyframe[] {
  return Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : emptyTrack;
}
