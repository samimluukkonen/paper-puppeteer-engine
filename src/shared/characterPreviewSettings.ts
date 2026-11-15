import { freezeData, type DeepReadonly, type TwoBoneIKDefinition } from '../engine/core.js';
import { demoPuppetCharacter, sketchCharacter } from './characterCatalog.js';
import { paperDollIK } from './paperDollIK.js';

export interface CharacterPreviewSettings {
  readonly ikChains: DeepReadonly<readonly TwoBoneIKDefinition[]>;
}

const paperDollPreview: CharacterPreviewSettings = freezeData({ ikChains: structuredClone(paperDollIK) });
const emptyPreview: CharacterPreviewSettings = freezeData({ ikChains: [] });
const previewSettings: Readonly<Record<string, CharacterPreviewSettings>> = Object.freeze({
  [demoPuppetCharacter.id]: paperDollPreview,
  [sketchCharacter.id]: paperDollPreview,
});

/** Editor-only characters can load any rig; preview chains are optional. */
export function getCharacterPreviewSettings(id: string): CharacterPreviewSettings {
  return Object.hasOwn(previewSettings, id) ? previewSettings[id]! : emptyPreview;
}
