/** Character identities shared by the demo and authoring tools. */
export const demoPuppetCharacter = Object.freeze({ id: 'demo-puppet', label: 'Demo puppet' });
export const sketchCharacter = Object.freeze({ id: 'random-paperdoll-sketch', label: 'Random paperdoll sketch' });
export const characterCatalog: readonly Readonly<{ id: string; label: string }>[] = Object.freeze([
  demoPuppetCharacter,
  sketchCharacter,
]);
export const defaultCharacterId = demoPuppetCharacter.id;
