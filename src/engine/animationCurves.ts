/** Segment-relative coordinates: x is time, y is progress from the start to end value.
 * Both axes stay in [0, 1]; curves cannot overshoot bounded channels such as IK mix.
 */
export interface CurveHandle {
  readonly x: number;
  readonly y: number;
}

/** An outgoing property segment. Missing metadata retains the clip's linear default. */
export type PropertyCurve =
  | { readonly mode: 'linear' }
  | { readonly mode: 'stepped' }
  | { readonly mode: 'bezier'; readonly control1: CurveHandle; readonly control2: CurveHandle };

export type PropertyCurves<Property extends string> = Readonly<Partial<Record<Property, PropertyCurve>>>;

/** Detached controls at authoring/compiled ownership boundaries. */
export function copyPropertyCurve(curve: PropertyCurve): PropertyCurve {
  return curve.mode === 'bezier'
    ? {
        mode: curve.mode,
        control1: { x: curve.control1.x, y: curve.control1.y },
        control2: { x: curve.control2.x, y: curve.control2.y },
      }
    : { mode: curve.mode };
}

/** Project one sparse authored channel without creating a second source of animation data. */
export function propertyKeyframe<Property extends string>(
  key: { readonly time: number; readonly curves?: PropertyCurves<Property> } & Partial<Record<Property, number>>,
  property: Property,
): { readonly time: number; readonly value: number; readonly curve?: PropertyCurve } {
  const curve = key.curves?.[property];
  return { time: key.time, value: key[property]!, ...(curve ? { curve: copyPropertyCurve(curve) } : {}) };
}

/** Remove a channel and its outgoing controls while retaining sparse siblings. */
export function withoutKeyframeProperty<
  Property extends string,
  Key extends { readonly curves?: PropertyCurves<Property> } & Partial<Record<Property, number>>,
>(key: Key, property: Property): Key {
  const row = { ...key };
  delete row[property];
  if (row.curves && Object.hasOwn(row.curves, property)) {
    const curves = { ...row.curves };
    delete curves[property];
    if (Object.keys(curves).length) Object.assign(row, { curves });
    else Reflect.deleteProperty(row, 'curves');
  }
  return row;
}

function cubicCoordinate(parameter: number, first: number, second: number): number {
  const inverse = 1 - parameter;
  return 3 * inverse * inverse * parameter * first + 3 * inverse * parameter * parameter * second + parameter ** 3;
}

/** Invert monotonic Bézier time using a fixed iteration count, including flat endpoint tangents.
 * Validated controls satisfy 0 <= control1.x <= control2.x <= 1. No derivative division is needed.
 */
export function evaluateCurveProgress(curve: PropertyCurve | undefined, progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  if (!curve || curve.mode === 'linear') return progress;
  if (curve.mode === 'stepped') return 0;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 52; iteration++) {
    const middle = (low + high) / 2;
    const time = cubicCoordinate(middle, curve.control1.x, curve.control2.x);
    if (time === progress) return cubicCoordinate(middle, curve.control1.y, curve.control2.y);
    if (time < progress) low = middle;
    else high = middle;
  }
  return cubicCoordinate((low + high) / 2, curve.control1.y, curve.control2.y);
}
