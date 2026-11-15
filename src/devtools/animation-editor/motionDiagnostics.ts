import {
  compileValidatedClip,
  sampleProperty,
  shortestRotationDelta,
  KEYFRAME_TIME_TOLERANCE_MS,
  type PropertyKeyframe,
} from '../../engine/core.js';
import type { Rig, TransformProperty } from '../../engine/data.js';
import { freezeData } from '../shared/editorData.js';
import { removeBonePropertyKeyframes, type PropertyKeyframeTarget } from './keyframeEdits.js';
import type { AnimationData } from './keyframeTargets.js';
import { getValidatedEditorAnimation } from './validatedAnimation.js';

export interface MotionDiagnosticOptions {
  rotationChange: number;
  rotationSpeed: number;
  positionChange: number;
  positionSpeed: number;
  speedRatio: number;
  rotationTolerance: number;
  positionTolerance: number;
  scaleTolerance: number;
}
/** Radians, local artwork units, seconds. Heuristics are suggestions, never error verdicts. */
export const DEFAULT_MOTION_OPTIONS: Readonly<MotionDiagnosticOptions> = Object.freeze({
  rotationChange: Math.PI / 2,
  rotationSpeed: Math.PI * 4,
  positionChange: 100,
  positionSpeed: 1000,
  speedRatio: 4,
  rotationTolerance: 0.001,
  positionTolerance: 0.01,
  scaleTolerance: 0.0001,
});
export interface MotionFinding {
  kind: 'bone' | 'ik';
  id: string;
  property: string;
  timeMs: number;
  message: string;
}
export interface CleanupCandidate extends PropertyKeyframeTarget {
  deviation: number;
  tolerance: number;
}
export interface MotionReport {
  findings: readonly MotionFinding[];
  candidates: readonly CleanupCandidate[];
  options: Readonly<MotionDiagnosticOptions>;
  notes: readonly string[];
}
export interface CleanupPreview<Animation> {
  animation: Animation;
  candidates: readonly CleanupCandidate[];
  maxDeviation: Readonly<Record<string, number>>;
}

function optionsWithDefaults(options: Partial<MotionDiagnosticOptions>): MotionDiagnosticOptions {
  const result = { ...DEFAULT_MOTION_OPTIONS, ...options };
  for (const [name, value] of Object.entries(result))
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and greater than zero.`);
  if (result.rotationTolerance >= Math.PI / 2) throw new Error('Rotation tolerance must be less than π/2 radians.');
  if (result.speedRatio <= 1) throw new Error('Speed ratio must be greater than one.');
  return result;
}
function delta(a: number, b: number, property: string): number {
  return property === 'rotation' ? shortestRotationDelta(a, b) : b - a;
}
function tolerance(property: TransformProperty, options: MotionDiagnosticOptions): number {
  return property === 'rotation'
    ? options.rotationTolerance
    : property === 'x' || property === 'y'
      ? options.positionTolerance
      : options.scaleTolerance;
}
function channel(animation: AnimationData, boneId: string, property: TransformProperty): PropertyKeyframe[] {
  return (animation.tracks[boneId] ?? []).flatMap((key) =>
    key[property] === undefined
      ? []
      : [
          {
            time: key.time,
            value: key[property],
            ...(key.curves?.[property] ? { curve: key.curves[property] } : {}),
          },
        ],
  );
}
/** Linear-only comparisons include every original knot (candidate knots are a subset).
 * Knot errors bound the continuous piecewise-linear difference; rotation subdivisions also check angular branches.
 * Work scales with authored keys rather than clip duration. Nonlinear/stepped channels never enter cleanup.
 */
function deviation(
  before: readonly PropertyKeyframe[],
  after: readonly PropertyKeyframe[],
  property: TransformProperty,
): number {
  let maximum = 0;
  for (let i = 0; i < before.length; i++) {
    const start = before[i]!.time;
    const end = before[i + 1]?.time ?? start;
    const subdivisions = property === 'rotation' ? 16 : 0;
    for (let step = 0; step <= subdivisions; step++) {
      const time = subdivisions ? start + (end - start) * (step / subdivisions) : start;
      maximum = Math.max(
        maximum,
        Math.abs(delta(sampleProperty(before, time, property), sampleProperty(after, time, property), property)),
      );
    }
  }
  return maximum;
}
function protectedBones(rig: Rig): Set<string> {
  const protectedIds = new Set<string>();
  // IK targets and every chain/ancestor transform remain byte-for-byte authored, including disabled baked chains.
  for (const constraint of rig.ik ?? []) {
    for (const bone of [constraint.rootBone, constraint.middleBone, constraint.endBone]) {
      let id: string | undefined = bone;
      while (id && !protectedIds.has(id)) {
        protectedIds.add(id);
        id = rig.getBone(id).parent;
      }
    }
  }
  return protectedIds;
}
function eligible(animation: AnimationData, rig: Rig, target: PropertyKeyframeTarget): boolean {
  if (protectedBones(rig).has(target.boneId)) return false;
  // Suppressed constraints are baking metadata. Preserve all baked rotation keys conservatively.
  if (target.property === 'rotation' && animation.disabledIKConstraints?.length) return false;
  const keys = channel(animation, target.boneId, target.property);
  const index = keys.findIndex((key) => key.time === target.timeMs);
  return (
    index > 0 &&
    index < keys.length - 1 &&
    !keys.some((key) => key.curve && key.curve.mode !== 'linear') &&
    !(animation.events ?? []).some((event) => Math.abs(event.time - target.timeMs) <= KEYFRAME_TIME_TOLERANCE_MS)
  );
}

/** Rebuild and verify the entire selected batch against the original, avoiding accumulated tolerance drift. */
export function previewMotionCleanup<Animation extends AnimationData>(
  source: Animation,
  rig: Rig,
  targets: readonly PropertyKeyframeTarget[],
  options: Partial<MotionDiagnosticOptions> = {},
): CleanupPreview<Animation> {
  getValidatedEditorAnimation(source, rig);
  const settings = optionsWithDefaults(options);
  const unique = [
    ...new Map(
      targets.map((target) => [JSON.stringify([target.boneId, target.property, target.timeMs]), target]),
    ).values(),
  ];
  if (unique.some((target) => !eligible(source, rig, target)))
    throw new Error('Cleanup selection contains a protected or unavailable key. Run diagnostics again.');
  const animation = removeBonePropertyKeyframes(source, rig, unique);
  const maxDeviation: Record<string, number> = {};
  const candidates = unique.map((target) => {
    const key = `${target.boneId}.${target.property}`;
    const error =
      maxDeviation[key] ??
      deviation(
        channel(source, target.boneId, target.property),
        channel(animation, target.boneId, target.property),
        target.property,
      );
    maxDeviation[key] = error;
    const limit = tolerance(target.property, settings);
    if (!Number.isFinite(error) || error > limit)
      throw new Error(`Cleanup exceeds ${key} tolerance (${error} > ${limit}). Select fewer keys.`);
    return { ...target, deviation: error, tolerance: limit };
  });
  return { animation, candidates: freezeData(candidates), maxDeviation: Object.freeze(maxDeviation) };
}

/** Manual analysis only. The runtime property sampler handles wraparound and all outgoing curve modes. */
export function diagnoseMotion(
  source: AnimationData,
  rig: Rig,
  options: Partial<MotionDiagnosticOptions> = {},
): MotionReport {
  getValidatedEditorAnimation(source, rig);
  const settings = optionsWithDefaults(options);
  const compiled = compileValidatedClip(source);
  const findings: MotionFinding[] = [];
  const candidates: CleanupCandidate[] = [];
  const notes: string[] = [];
  if (source.rootMotion?.translationKeys.length)
    notes.push(
      'Root Motion curves are preserved but not analyzed or cleaned up. Inspect their X/Y curves in Graph Editor.',
    );
  const protectedIds = protectedBones(rig);
  for (const track of [
    ...compiled.tracks.map((track) => ({ kind: 'bone' as const, id: track.bone, properties: track.properties })),
    ...(compiled.ikTracks ?? []).map((track) => ({
      kind: 'ik' as const,
      id: track.constraint,
      properties: track.properties,
    })),
  ]) {
    for (const [property, keys] of track.properties) {
      let previousSpeed = 0;
      for (let index = 1; index < keys.length; index++) {
        const a = keys[index - 1]!;
        const b = keys[index]!;
        const distance = Math.abs(delta(a.value, b.value, property));
        const seconds = Math.max((b.time - a.time) / 1000, Number.MIN_VALUE);
        let peakSpeed = distance / seconds;
        // Linear segments have constant speed. Only nonlinear/held segments need
        // subdivision samples; all sampling still goes through the runtime evaluator.
        for (let step = 1; a.curve && a.curve.mode !== 'linear' && step <= 16; step++) {
          const t0 = a.time + (b.time - a.time) * ((step - 1) / 16);
          const t1 = a.time + (b.time - a.time) * (step / 16);
          peakSpeed = Math.max(
            peakSpeed,
            Math.abs(
              delta(
                sampleProperty(keys, t0, property === 'rotation' ? 'rotation' : undefined),
                sampleProperty(keys, t1, property === 'rotation' ? 'rotation' : undefined),
                property,
              ),
            ) / Math.max(seconds / 16, Number.MIN_VALUE),
          );
        }
        const rotation = property === 'rotation';
        const position = property === 'x' || property === 'y';
        const limit = rotation ? settings.rotationSpeed : settings.positionSpeed;
        const reasons: string[] = [];
        if ((rotation || position) && distance > (rotation ? settings.rotationChange : settings.positionChange))
          reasons.push(`large change (${distance.toPrecision(4)} ${rotation ? 'rad' : 'units'})`);
        if ((rotation || position) && peakSpeed > limit)
          reasons.push(`rapid motion (${peakSpeed.toPrecision(4)} ${rotation ? 'rad/s' : 'units/s'})`);
        if (
          (rotation || position) &&
          previousSpeed > limit / settings.speedRatio &&
          peakSpeed > previousSpeed * settings.speedRatio
        )
          reasons.push('sudden speed increase');
        if (distance > 0 && a.curve?.mode === 'stepped') reasons.push('stepped discontinuity');
        if (index > 1 && (keys[index - 2]!.curve?.mode ?? 'linear') !== (a.curve?.mode ?? 'linear'))
          reasons.push('interpolation mode change');
        if (reasons.length)
          findings.push({
            kind: track.kind,
            id: track.id,
            property,
            timeMs: b.time,
            message: `Possible ${reasons.join('; ')}. Fast or stepped motion may be intentional.`,
          });
        previousSpeed = peakSpeed;
      }
      if (track.kind !== 'bone' || protectedIds.has(track.id)) continue;
      if (property === 'rotation' && source.disabledIKConstraints?.length) continue;
      if (keys.some((key) => key.curve && key.curve.mode !== 'linear')) continue;
      // Bound the quadratic simplification pass; issue detection above still inspects every key.
      if (keys.length > 256) {
        notes.push(`Cleanup skipped ${track.id}.${property}: more than 256 property keys. Issue detection still ran.`);
        continue;
      }
      const transform = property as TransformProperty;
      const limit = tolerance(transform, settings);
      let remaining = [...keys];
      const accepted: PropertyKeyframeTarget[] = [];
      let error = 0;
      for (const key of keys.slice(1, -1)) {
        if ((source.events ?? []).some((event) => Math.abs(event.time - key.time) <= KEYFRAME_TIME_TOLERANCE_MS))
          continue;
        const proposed = remaining.filter((candidate) => candidate.time !== key.time);
        const measured = deviation(keys, proposed, transform);
        if (!Number.isFinite(measured) || measured > limit) continue;
        remaining = proposed;
        error = measured;
        accepted.push({ boneId: track.id, property: transform, timeMs: key.time });
      }
      candidates.push(...accepted.map((target) => ({ ...target, deviation: error, tolerance: limit })));
    }
  }
  return freezeData({ findings, candidates, options: settings, notes });
}
