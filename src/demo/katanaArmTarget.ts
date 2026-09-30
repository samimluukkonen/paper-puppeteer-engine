import type { IKTarget } from '../engine/index.js';

/** Translation of the primary grip that brings the secondary grip within arm reach. */
export function gripReachCorrection(
  shoulder: IKTarget,
  grip: IKTarget,
  upperLength: number,
  lowerLength: number,
  reachReserve = 1.5,
): IKTarget {
  const dx = grip.x - shoulder.x;
  const dy = grip.y - shoulder.y;
  const distance = Math.hypot(dx, dy);
  const minimum = Math.abs(upperLength - lowerLength) + 0.5;
  const maximum = upperLength + lowerLength - reachReserve;
  if (distance >= minimum && distance <= maximum) return { x: 0, y: 0 };
  const desired = Math.max(minimum, Math.min(maximum, distance));
  if (distance < 1e-8) return { x: desired, y: 0 };
  const scale = (desired - distance) / distance;
  return { x: dx * scale, y: dy * scale };
}

/** Horizontal span where a line crosses a transformed cutout. */
export function horizontalEdgesAtY(
  corners: readonly IKTarget[],
  y: number,
): { left: number; right: number } | undefined {
  let left = Infinity;
  let right = -Infinity;
  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index]!;
    const b = corners[(index + 1) % corners.length]!;
    if (Math.abs(a.y - b.y) < 1e-8) {
      if (Math.abs(y - a.y) < 1e-8) {
        left = Math.min(left, a.x, b.x);
        right = Math.max(right, a.x, b.x);
      }
    } else if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) {
      const x = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return Number.isFinite(left) ? { left, right } : undefined;
}

/** Take a bounded step toward a palm target, routing across the head's top corners. */
export function stepPalmAroundHead(
  previous: IKTarget,
  desired: IKTarget,
  head: { left: number; right: number; top: number },
  margin: number,
  maximumStep: number,
): IKTarget {
  const left = head.left - margin;
  const right = head.right + margin;
  const top = head.top - margin;
  const center = (head.left + head.right) / 2;
  let waypoint = desired;
  if (previous.x > center && previous.y > top + 1 && desired.x < right) {
    waypoint = { x: right, y: top };
  } else if (previous.x < center && previous.y > top + 1 && desired.x > left) {
    waypoint = { x: left, y: top };
  } else if (previous.y <= top + 1 && desired.y > top + 1 && desired.x <= left && previous.x > left + 1) {
    waypoint = { x: left, y: top };
  } else if (previous.y <= top + 1 && desired.y > top + 1 && desired.x >= right && previous.x < right - 1) {
    waypoint = { x: right, y: top };
  }
  const dx = waypoint.x - previous.x;
  const dy = waypoint.y - previous.y;
  const distance = Math.hypot(dx, dy);
  const scale = distance > maximumStep ? maximumStep / distance : 1;
  return { x: previous.x + dx * scale, y: previous.y + dy * scale };
}
