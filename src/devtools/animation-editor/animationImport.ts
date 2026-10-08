import {
  ANIMATION_FORMAT_VERSION,
  inspectAnimationDefinition,
  type ValidationIssue,
} from '../../engine/externalData.js';
import type { Rig } from '../../engine/Rig.js';
import { freezeData } from '../shared/editorData.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import { serializeAnimation } from './animationSerialization.js';

export type AnimationImportResult =
  | { success: true; data: ReadonlyAnimation; issues: readonly ValidationIssue[] }
  | { success: false; issues: readonly ValidationIssue[] };

/** Shared paste/file boundary: unknown JSON becomes an owned snapshot only after strict file/rig validation. */
export function importAnimationJson(json: string, rig?: Rig): AnimationImportResult {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch (error) {
    return {
      success: false,
      issues: [
        { severity: 'error', message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` },
      ],
    };
  }
  if (!rig)
    return {
      success: false,
      issues: [{ severity: 'error', message: 'Load a character before importing an animation.' }],
    };
  const result = inspectAnimationDefinition(input, rig);
  if (!result.data) return { success: false, issues: result.issues };
  return {
    success: true,
    data: freezeData({ ...result.data, version: ANIMATION_FORMAT_VERSION }),
    issues: result.issues,
  };
}

export type AnimationRoundTripResult =
  | { success: true; equivalent: boolean; json: string; reexportedJson: string; data: ReadonlyAnimation }
  | { success: false; issues: readonly ValidationIssue[] };

/** Compare authored semantics using the existing canonical number, field and event ordering rules. */
export function verifyAnimationRoundTrip(input: unknown, rig: Rig): AnimationRoundTripResult {
  const exported = serializeAnimation(input, rig);
  if (!exported.success) return exported;
  const imported = importAnimationJson(exported.json, rig);
  if (!imported.success) return imported;
  const reexported = serializeAnimation(imported.data, rig);
  if (!reexported.success) return reexported;
  return {
    success: true,
    equivalent: exported.json === reexported.json,
    json: exported.json,
    reexportedJson: reexported.json,
    data: imported.data,
  };
}
