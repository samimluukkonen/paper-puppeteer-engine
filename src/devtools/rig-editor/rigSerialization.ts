import type { RigJsonDefinition } from '../../engine/externalData.js';
import type { RigDefinition } from '../../engine/types.js';
import { roundEditorNumber } from '../shared/editorData.js';

/** Order authoring fields consistently without changing array order or untouched numbers. */
function stable(value: unknown, original: unknown): unknown {
  if (typeof value === 'number') return value === original ? value : roundEditorNumber(value);
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
        .map((key) => [key, stable(source[key], baseline[key])]),
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
