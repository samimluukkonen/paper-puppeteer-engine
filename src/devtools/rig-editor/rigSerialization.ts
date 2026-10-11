import type { RigJsonDefinition } from '../../engine/externalData.js';
import { assertJsonInputSize } from '../../engine/jsonInput.js';
import type { RigDefinition } from '../../engine/types.js';
import { roundEditorNumber } from '../shared/editorData.js';

// Rounding these fields can collapse transforms, reorder artwork, or change a frame id.
const exactNumberFields = new Set(['scaleX', 'scaleY', 'length', 'depth', 'frame']);

/** Order authoring fields consistently without changing array order or untouched numbers. */
function stable(value: unknown, original: unknown, field?: string): unknown {
  if (typeof value === 'number') {
    if (value === original || (field !== undefined && exactNumberFields.has(field))) return value;
    const rounded = roundEditorNumber(value);
    // A small authored offset or angle must not silently become exactly zero either.
    return rounded === 0 && value !== 0 ? value : rounded;
  }
  if (Array.isArray(value))
    return value.map((entry, index) => stable(entry, Array.isArray(original) ? original[index] : undefined));
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
          return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b);
        })
        .map((key) => [key, stable(source[key], baseline[key], key)]),
    );
  }
  return value;
}

export function serializeRigData(candidate: RigJsonDefinition, initial: RigDefinition): RigJsonDefinition {
  return stable(candidate, {
    ...candidate,
    bones: initial.bones,
    slots: initial.slots,
    attachments: initial.attachments,
    skins: initial.skins,
  }) as RigJsonDefinition;
}

/** Check the exact downloaded/copied bytes against the rig import limit before saving a baseline. */
export function serializeRigJson(rig: RigJsonDefinition): string {
  const json = `${JSON.stringify(rig, null, 2)}\n`;
  assertJsonInputSize(json);
  return json;
}
