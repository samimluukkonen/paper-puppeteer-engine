import type { MeshDeformationKey, VertexOffset } from '../../engine/meshDeformation.js';
import { getMeshDeformationTrack, sampleMeshDeformation } from '../../engine/meshDeformation.js';
import type { Rig } from '../../engine/Rig.js';
import { validateEditedAnimation, type ReadonlyAnimation } from './validatedAnimation.js';

/** Exact times, like graph edits. A move never silently overwrites a neighboring shape. */
export function editDeformationKey(
  animation: ReadonlyAnimation,
  rig: Rig,
  meshId: string,
  key: MeshDeformationKey | null,
  previousTime?: number,
): ReadonlyAnimation {
  const keys = getMeshDeformationTrack(animation, meshId);
  if (previousTime !== undefined && !keys.some((entry) => entry.time === previousTime))
    throw new Error('Select an existing deformation key first.');
  if (key && keys.some((entry) => entry.time === key.time && entry.time !== previousTime))
    throw new Error('A deformation key already exists at that time. Choose another time.');
  const next = keys.filter((entry) => entry.time !== previousTime);
  if (key) next.push(key);
  next.sort((a, b) => a.time - b.time);
  return validateEditedAnimation(
    { ...animation, deformationTracks: { ...animation.deformationTracks, [meshId]: next } },
    animation,
    rig,
  );
}

export function setDeformationOffsets(
  animation: ReadonlyAnimation,
  rig: Rig,
  meshId: string,
  time: number,
  changes: Readonly<Record<string, VertexOffset>> | null,
): ReadonlyAnimation {
  const keys = getMeshDeformationTrack(animation, meshId);
  const old = keys.find((key) => key.time === time);
  const offsets =
    changes === null
      ? {}
      : Object.fromEntries(
          Object.entries({ ...Object.fromEntries(sampleMeshDeformation(keys, time)), ...changes }).filter(
            ([, offset]) => offset.x !== 0 || offset.y !== 0,
          ),
        );
  return editDeformationKey(
    animation,
    rig,
    meshId,
    { time, offsets, ...(old?.curve ? { curve: old.curve } : {}) },
    old?.time,
  );
}
