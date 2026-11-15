import {
  localToWorld,
  worldToLocal,
  getFootContactWorldPosition,
  setIKPropertyKeyframe,
  IsolatedIKSampler,
  type Affine,
} from '../../engine/core.js';
import type { Rig, FootContactMarker } from '../../engine/data.js';
import { DEFAULT_CONTACT_TOLERANCE } from '../shared/footContactGround.js';
import type { AnimationData } from './keyframeTargets.js';
import { getCompiledPreviewClip } from './previewClip.js';

/** A foot may carry its marker on a descendant of the chain's end bone. No naming conventions. */
export function footContactConstraints(rig: Rig, marker: FootContactMarker) {
  const ancestors = new Set<string>();
  let id: string | undefined = marker.boneId;
  while (id !== undefined) {
    ancestors.add(id);
    id = rig.getBone(id).parent;
  }
  return (rig.ik ?? []).filter((constraint) => ancestors.has(constraint.endBone));
}

/** Plan on detached joints using the normal key API and solver. Never change the live pose or clip.
 * Search along world Y of the requested target; retain its world X. Each candidate is evaluated
 * exactly as the eventual committed clip, including stepped playback and later constraints.
 */
export function planFootContactAlignment(
  animation: AnimationData,
  rig: Rig,
  time: number,
  markerId: string,
  constraintId: string,
  puppetToWorld: Affine,
  groundY: number,
  tolerance = DEFAULT_CONTACT_TOLERANCE,
) {
  if (!Number.isFinite(groundY) || !Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error('Use a finite ground height and positive contact tolerance.');
  const marker = rig.footContactMarkers?.find((entry) => entry.id === markerId);
  if (!marker) throw new Error('Select a foot contact marker.');
  if (!footContactConstraints(rig, marker).some((entry) => entry.name === constraintId))
    throw new Error('This marker requires manual posing or an existing foot IK setup.');
  const sampler = new IsolatedIKSampler(rig);
  const initial = sampler.sample(getCompiledPreviewClip(animation, rig), time);
  const originalTarget = initial.targets.get(constraintId)!;
  const requestedWorld = localToWorld(originalTarget, puppetToWorld);
  if (!worldToLocal(requestedWorld, puppetToWorld)) throw new Error('The Puppet transform is singular.');
  const evaluate = (worldY: number) => {
    const target = worldToLocal({ x: requestedWorld.x, y: worldY }, puppetToWorld)!;
    const candidate = setIKPropertyKeyframe(
      setIKPropertyKeyframe(animation, rig, constraintId, 'x', time, target.x),
      rig,
      constraintId,
      'y',
      time,
      target.y,
    );
    const sample = sampler.sample(getCompiledPreviewClip(candidate, rig), time);
    const contact = getFootContactWorldPosition(marker, rig, sample.pose, puppetToWorld);
    if (!contact) throw new Error('The evaluated contact position is unavailable.');
    const residual = contact.y - groundY;
    const status = sample.constraints.get(constraintId)!.status;
    return { target, pose: sample.pose, contact, residual, status, worldY };
  };
  let best = evaluate(requestedWorld.y);
  const definition = rig.ik!.find((entry) => entry.name === constraintId)!;
  const endpoint = getFootContactWorldPosition(
    {
      ...marker,
      boneId: definition.endBone,
      localX: definition.endOffset?.x ?? 0,
      localY: definition.endOffset?.y ?? 0,
    },
    rig,
    initial.pose,
    puppetToWorld,
  );
  // Start near the evaluated endpoint too: an original request far beyond chain reach can
  // sit on a flat clamped plateau, where small target corrections have no observable effect.
  if (endpoint) {
    const seed = evaluate(endpoint.y - best.residual);
    if (Math.abs(seed.residual) <= Math.abs(best.residual)) best = seed;
  }
  // A bounded scalar Newton search with a line search also handles marker/end-offset differences
  // and partial influence. Clamped chains can stop improving; retain/report the best actual result.
  for (let iteration = 0; iteration < 20 && Math.abs(best.residual) > tolerance; iteration++) {
    if (best.status === 'inactive' || best.status === 'singular-transform' || best.status === 'unsupported-scale')
      break;
    const h = Math.max(0.01, Math.abs(best.worldY) * 1e-5);
    const derivative = (evaluate(best.worldY + h).residual - evaluate(best.worldY - h).residual) / (2 * h);
    const correction = Math.abs(derivative) > 1e-6 ? -best.residual / derivative : -best.residual;
    const step = Math.max(-10000, Math.min(10000, correction));
    let next = best;
    for (let fraction = 1; fraction >= 1 / 64; fraction /= 2) {
      const trial = evaluate(best.worldY + step * fraction);
      if (Math.abs(trial.residual) < Math.abs(next.residual)) next = trial;
      if (Math.abs(next.residual) <= tolerance) break;
    }
    if (Math.abs(best.residual) - Math.abs(next.residual) < 1e-8) break;
    best = next;
  }
  const success =
    Math.abs(best.residual) <= tolerance &&
    best.status !== 'inactive' &&
    best.status !== 'singular-transform' &&
    best.status !== 'unsupported-scale';
  return Object.freeze({ ...best, success, tolerance, originalTarget: { x: originalTarget.x, y: originalTarget.y } });
}

export type FootContactAlignment = ReturnType<typeof planFootContactAlignment>;
