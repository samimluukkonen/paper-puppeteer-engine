import { rotationDifference } from '../animationMath.js';
import { assertFinite } from '../types.js';
import type { BendDirection, IKTarget } from './types.js';

export const IK_EPSILON = 1e-8;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

export interface TwoBoneIKInput {
  root: IKTarget;
  target: IKTarget;
  lengthA: number;
  lengthB: number;
  bendDirection: BendDirection;
  /** Direction used when the target coincides with the root. */
  fallbackRotation?: number;
}

export interface TwoBoneIKResult {
  /** Absolute direction of the first segment, measured from +X. */
  rootRotation: number;
  /** Signed angle of the second segment relative to the first. */
  middleRotation: number;
  middle: IKTarget;
  end: IKTarget;
  reachable: boolean;
}

export function assertBendDirection(value: number): asserts value is BendDirection {
  if (value !== 1 && value !== -1) throw new Error('IK bendDirection must be 1 or -1.');
}

/** Law-of-cosines solution, independent of sprites, transforms and Phaser. */
export function solveTwoBoneIK(input: TwoBoneIKInput): TwoBoneIKResult {
  const { root, target, lengthA, lengthB, bendDirection } = input;
  const fallback = input.fallbackRotation ?? 0;
  for (const [name, value] of Object.entries({
    rootX: root.x,
    rootY: root.y,
    targetX: target.x,
    targetY: target.y,
    lengthA,
    lengthB,
    fallback,
  }))
    assertFinite(value, `IK ${name}`);
  assertBendDirection(bendDirection);
  if (lengthA < 0 || lengthB < 0) throw new Error('IK lengths cannot be negative.');
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const distance = Math.hypot(dx, dy);
  assertFinite(distance, 'IK target distance');
  assertFinite(lengthA + lengthB, 'IK total length');
  const direction = distance > IK_EPSILON ? Math.atan2(dy, dx) : fallback;
  let rootRotation = direction;
  let middleRotation = 0;
  const reachable = distance >= Math.abs(lengthA - lengthB) - IK_EPSILON && distance <= lengthA + lengthB + IK_EPSILON;

  if (lengthA > IK_EPSILON && lengthB > IK_EPSILON) {
    const reach = clamp(distance, Math.abs(lengthA - lengthB), lengthA + lengthB);
    // Normalize before squaring to avoid overflow for large lengths.
    const scale = Math.max(lengthA, lengthB, reach);
    const a = lengthA / scale;
    const b = lengthB / scale;
    const d = reach / scale;
    const fullyExtended = reach === lengthA + lengthB;
    const fullyFolded = reach === Math.abs(lengthA - lengthB);
    const shoulder = fullyExtended
      ? 0
      : reach <= IK_EPSILON
        ? Math.PI / 2
        : fullyFolded
          ? lengthA >= lengthB
            ? 0
            : Math.PI
          : Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const elbow = fullyExtended
      ? 0
      : fullyFolded
        ? Math.PI
        : Math.acos(clamp((d * d - a * a - b * b) / (2 * a * b), -1, 1));
    rootRotation = direction - bendDirection * shoulder;
    middleRotation = bendDirection * elbow;
  }

  const middle = {
    x: root.x + lengthA * Math.cos(rootRotation),
    y: root.y + lengthA * Math.sin(rootRotation),
  };
  const end = {
    x: middle.x + lengthB * Math.cos(rootRotation + middleRotation),
    y: middle.y + lengthB * Math.sin(rootRotation + middleRotation),
  };
  return { rootRotation, middleRotation, middle, end, reachable };
}

/** Blend the nearest equivalent IK angle, preserving authored full turns. */
export function blendIKRotation(from: number, to: number, mix: number): number {
  assertFinite(from, 'IK source rotation');
  assertFinite(to, 'IK solved rotation');
  assertFinite(mix, 'IK mix');
  if (mix < 0 || mix > 1) throw new Error('IK mix must be between 0 and 1.');
  if (mix === 0) return from;
  const difference = rotationDifference(from, to);
  const delta = Math.atan2(Math.sin(difference), Math.cos(difference));
  return from + delta * mix;
}
