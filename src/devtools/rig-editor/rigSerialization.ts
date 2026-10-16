import type { RigJsonDefinition } from '../../engine/externalData.js';
import { assertJsonInputSize } from '../../engine/jsonInput.js';
import type { RigDefinition } from '../../engine/types.js';
import { roundEditorNumber } from '../shared/editorData.js';

// Rounding these fields can collapse transforms, reorder artwork, or change a frame id.
const exactNumberFields = new Set(['scaleX', 'scaleY', 'length', 'depth', 'frame', 'originX', 'originY']);

/** Order authoring fields consistently without changing array order or untouched numbers. */
function stable(value: unknown, original: unknown, field?: string, artwork = false): unknown {
  if (typeof value === 'number') {
    if (artwork || value === original || (field !== undefined && exactNumberFields.has(field))) return value;
    const rounded = roundEditorNumber(value);
    // A small authored offset or angle must not silently become exactly zero either.
    return rounded === 0 && value !== 0 ? value : rounded;
  }
  if (Array.isArray(value))
    return value.map((entry, index) =>
      stable(entry, Array.isArray(original) ? original[index] : undefined, undefined, artwork),
    );
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const baseline = original && typeof original === 'object' ? (original as Record<string, unknown>) : {};
    const order = [
      'version',
      'name',
      'root',
      'bones',
      'slots',
      'attachments',
      'skins',
      'id',
      'parent',
      'bone',
      'length',
      'sprite',
      'depth',
      'texture',
      'frame',
      'x',
      'y',
      'rotation',
      'scaleX',
      'scaleY',
      'originX',
      'originY',
    ];
    return Object.fromEntries(
      Object.keys(source)
        .sort((a, b) => {
          const ai = order.indexOf(a),
            bi = order.indexOf(b);
          return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || (a < b ? -1 : a > b ? 1 : 0);
        })
        .map((key) => [
          key,
          stable(source[key], baseline[key], key, artwork || key === 'sprite' || key === 'attachments'),
        ]),
    );
  }
  return value;
}

/** Structural edits can shift array positions; untouched values still belong to the same authored ID. */
function baselineById<T extends { id: string }>(current: readonly T[] | undefined, original: readonly T[] | undefined) {
  const entries = new Map((original ?? []).map((entry) => [entry.id, entry]));
  return current?.map((entry) => entries.get(entry.id));
}

export function serializeRigData(candidate: RigJsonDefinition, initial: RigDefinition): RigJsonDefinition {
  return stable(candidate, {
    ...candidate,
    bones: baselineById(candidate.bones, initial.bones),
    slots: baselineById(candidate.slots, initial.slots),
    attachments: baselineById(candidate.attachments, initial.attachments),
    skins: initial.skins,
  }) as RigJsonDefinition;
}

/** Check the exact downloaded/copied bytes against the rig import limit before saving a baseline. */
export function serializeRigJson(rig: RigJsonDefinition): string {
  const json = `${JSON.stringify(rig, null, 2)}\n`;
  assertJsonInputSize(json);
  return json;
}
