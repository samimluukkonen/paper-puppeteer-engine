import { AnimationValidationError } from '../../engine/externalData.js';
import type { Rig } from '../../engine/Rig.js';
import { inspectEditorAnimation, type ReadonlyAnimation } from './validatedAnimation.js';

export interface AnimationVariationOptions {
  /** Version-1 animations use one name as their stable workspace/runtime ID. */
  name: string;
  /** Whole-clip duration multiplier: 2 is twice as long, 0.5 is twice as fast. */
  timeScale?: number;
}

/** Own every JSON branch, then validate using the ordinary animation document boundary. */
export function createAnimationVariation(
  source: ReadonlyAnimation,
  rig: Rig,
  options: AnimationVariationOptions,
): ReadonlyAnimation {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.name))
    throw new Error('Animation name / ID must start with a letter or number and use only letters, numbers, - or _.');
  const scale = options.timeScale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Time scale must be a finite number greater than zero.');
  const copy = structuredClone(source);
  const scaleRows = <Row extends { readonly time: number }>(rows: readonly Row[]): Row[] => {
    const scaled = rows.map((row) => ({ ...row, time: row.time * scale }));
    if (scaled.some((row, index) => index > 0 && row.time <= scaled[index - 1]!.time))
      throw new Error('Time scaling cannot preserve distinct keys at this time precision.');
    return scaled;
  };
  const result = inspectEditorAnimation(
    {
      ...copy,
      name: options.name,
      duration: copy.duration * scale,
      tracks: Object.fromEntries(Object.entries(copy.tracks).map(([id, rows]) => [id, scaleRows(rows)])),
      ...(copy.rootMotion ? { rootMotion: { translationKeys: scaleRows(copy.rootMotion.translationKeys) } } : {}),
      ...(copy.ikTracks
        ? { ikTracks: Object.fromEntries(Object.entries(copy.ikTracks).map(([id, rows]) => [id, scaleRows(rows)])) }
        : {}),
      ...(copy.events ? { events: copy.events.map((event) => ({ ...event, time: event.time * scale })) } : {}),
    },
    rig,
  );
  if (!result.data) throw new AnimationValidationError(result.issues);
  return result.data;
}
