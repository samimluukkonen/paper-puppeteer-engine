import {
  ANIMATION_FORMAT_VERSION,
  inspectAnimationDefinition,
  type AnimationJsonDefinition,
  type JsonValue,
  type ValidationIssue,
} from '../../engine/externalData.js';
import { ikAnimationProperties } from '../../engine/ik/animationKeyframes.js';
import { assertJsonInputSize, JsonInputLimitError } from '../../engine/jsonInput.js';
import type { Rig } from '../../engine/Rig.js';
import { transformProperties } from '../../engine/types.js';
import { roundEditorNumber } from '../shared/editorData.js';

export type AnimationExportResult =
  | { success: true; data: AnimationJsonDefinition; json: string; issues: readonly ValidationIssue[] }
  | { success: false; issues: readonly ValidationIssue[] };

/** Remove arithmetic noise near editor decimals, retaining precision, tiny values and exact integers. */
function normalizeNumber(value: number): number {
  if (Number.isInteger(value)) return value;
  const rounded = roundEditorNumber(value);
  return rounded !== 0 && Math.abs(rounded - value) <= Number.EPSILON * Math.abs(value) * 4 ? rounded : value;
}

/** Payload numbers are application data; only object field order is canonicalized. */
function orderPayload(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => orderPayload(entry as JsonValue));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, orderPayload((value as Record<string, JsonValue>)[key]!)]),
    );
  }
  return value;
}

/** One validated, side-effect-free serialization boundary for every animation export destination. */
export function serializeAnimation(input: unknown, rig: Rig): AnimationExportResult {
  // Validate the original before projection or normalization can hide invalid authored data.
  const inspected = inspectAnimationDefinition(input, rig);
  if (!inspected.data) return { success: false, issues: inspected.issues };
  // The existing file validator has checked every event payload as plain JSON.
  const animation = inspected.data as Omit<AnimationJsonDefinition, 'version'>;
  const times = [
    ...new Set([
      0,
      animation.duration,
      ...Object.values(animation.tracks).flatMap((keys) => keys.map((key) => key.time)),
      ...Object.values(animation.ikTracks ?? {}).flatMap((keys) => keys.map((key) => key.time)),
      ...(animation.events ?? []).map((event) => event.time),
    ]),
  ].sort((a, b) => a - b);
  const normalizedTimes = times.map(normalizeNumber);
  // Retain close, distinct authored times instead of merging keys/events or changing endpoint semantics.
  const safeTimes = new Map(
    times.map((time, index) => [
      time,
      (index > 0 && normalizedTimes[index - 1]! >= normalizedTimes[index]!) ||
      (index + 1 < times.length && normalizedTimes[index]! >= normalizedTimes[index + 1]!)
        ? time
        : normalizedTimes[index]!,
    ]),
  );
  const timeValue = (time: number): number => safeTimes.get(time)!;
  const data: AnimationJsonDefinition = {
    version: ANIMATION_FORMAT_VERSION,
    name: animation.name,
    duration: timeValue(animation.duration),
    loop: animation.loop,
    ...(animation.interpolation === undefined ? {} : { interpolation: animation.interpolation }),
    ...(animation.playback === undefined
      ? {}
      : {
          playback:
            animation.playback.mode === 'stepped'
              ? { mode: 'stepped', fps: normalizeNumber(animation.playback.fps) }
              : { mode: 'smooth' },
        }),
    tracks: Object.fromEntries(
      Object.keys(animation.tracks)
        .sort()
        .map((bone) => [
          bone,
          animation.tracks[bone]!.map((key) => ({
            time: timeValue(key.time),
            ...Object.fromEntries(
              transformProperties
                .filter((property) => key[property] !== undefined)
                .map((property) => [property, normalizeNumber(key[property]!)]),
            ),
          })),
        ]),
    ),
    ...(animation.ikTracks === undefined
      ? {}
      : {
          ikTracks: Object.fromEntries(
            Object.keys(animation.ikTracks)
              .sort()
              .map((name) => [
                name,
                animation.ikTracks![name]!.map((key) => ({
                  time: timeValue(key.time),
                  ...Object.fromEntries(
                    ikAnimationProperties
                      .filter((property) => key[property] !== undefined)
                      .map((property) => [property, normalizeNumber(key[property]!)]),
                  ),
                })),
              ]),
          ),
        }),
    ...(animation.events === undefined
      ? {}
      : {
          // Stable sort matches runtime compilation, including authored order for equal-time events.
          events: [...animation.events]
            .sort((a, b) => a.time - b.time)
            .map((event) => ({
              time: timeValue(event.time),
              name: event.name,
              ...(Object.hasOwn(event, 'data') ? { data: orderPayload(event.data!) } : {}),
            })),
        }),
  };
  const output = inspectAnimationDefinition(data, rig);
  if (!output.data) return { success: false, issues: output.issues };
  const json = `${JSON.stringify(data, null, 2)}\n`;
  try {
    assertJsonInputSize(json);
  } catch (error) {
    if (!(error instanceof JsonInputLimitError)) throw error;
    return { success: false, issues: [{ severity: 'error', message: error.message }] };
  }
  return { success: true, data, json, issues: inspected.issues };
}
