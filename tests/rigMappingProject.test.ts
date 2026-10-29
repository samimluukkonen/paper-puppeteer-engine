import { expect, test } from 'vitest';
import { parseProjectDefinition } from '../src/devtools/project/ProjectDefinition.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import { buildCharacterPackage } from '../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { createRigBoneMapping } from '../src/engine/rigBoneMapping.js';

async function projectFixture() {
  const project = new ProjectWorkspace('Rig comparison', 'film');
  for (const id of ['source', 'target']) {
    const draft = createNewCharacter({ id, name: id });
    await project.addCharacter(
      await buildCharacterPackage({
        definition: draft.definition,
        rig: draft.definition.rigFile!,
        skins: draft.definition.standaloneSkins,
        animations: [],
        replacements: [],
      }),
    );
  }
  const a = project.rigSource('source'),
    b = project.rigSource('target');
  const map = createRigBoneMapping(
    a,
    b,
    a.rig.bones.map((bone) => ({ sourceBoneId: bone.id, targetBoneId: bone.id })),
    'map',
    'Reusable map',
  );
  return { project, map };
}

test('approved maps own detached immutable metadata and participate in project history and autosave identity', async () => {
  const { project, map } = await projectFixture();
  const before = project.autosaveRevision;
  project.saveRigMapping(map);
  expect(project.autosaveRevision).not.toBe(before);
  expect(project.definition.rigMappings).toEqual([map]);
  expect(Object.isFrozen(project.definition.rigMappings![0]!.entries)).toBe(true);
  project.undo();
  expect(project.definition.rigMappings).toBeUndefined();
  expect(project.autosaveRevision).toBe(before);
  project.redo();
  expect(project.definition.rigMappings).toEqual([map]);
  project.removeRigMapping(map.id);
  expect(project.definition.rigMappings).toEqual([]);
  project.undo();
  expect(project.definition.rigMappings).toEqual([map]);
  expect(() => project.remove('characters', 'target')).toThrow(/Reusable map/);
});

test('portable project and local-recovery payloads preserve mappings without adding runtime editor objects', async () => {
  const { project, map } = await projectFixture();
  project.saveRigMapping(map);
  const captured = await buildProjectPackage(project);
  const restored = await importProjectPackage(decodePackageZip(encodePackageZip(captured.files)));
  expect(restored.definition.rigMappings).toEqual([map]);
  expect(restored.rigMappingReport(map)).toMatchObject({ level: 'mappable', mappingValid: true });
  expect(restored.inspect('export').counts.error).toBe(0);
  expect(JSON.stringify(restored.definition.rigMappings)).not.toMatch(/definitions|renderOrder|capture/);
});

test('working rig edits invalidate maps immediately; stale metadata survives export/import for repair', async () => {
  const { project, map } = await projectFixture();
  project.saveRigMapping(map);
  const snapshot = project.captureCharacter('target');
  const updated = {
    ...snapshot,
    rig: { ...snapshot.rig, bones: snapshot.rig.bones.map((bone) => ({ ...bone, rotation: 0.3 })) },
  };
  project.character('target').capture = () => updated;
  project.refresh();
  expect(project.rigMappingReport(map)).toMatchObject({ level: 'incompatible', mappingValid: false });
  expect(() => project.saveRigMapping(map)).toThrow(/Rig data changed/);
  const issue = project.inspect('export').issues.find((issue) => issue.asset.kind === 'rig-mapping');
  expect(issue?.severity).toBe('warning');
  expect(issue?.message).toContain('Rig data changed');
  const restored = await importProjectPackage((await buildProjectPackage(project)).files);
  expect(restored.definition.rigMappings).toEqual([map]);
  expect(restored.rigMappingReport(map).mappingValid).toBe(false);
  const current = createRigBoneMapping(
    restored.rigSource('source'),
    restored.rigSource('target'),
    map.entries,
    map.id,
    map.name,
  );
  restored.saveRigMapping(current);
  expect(restored.rigMappingReport(current).mappingValid).toBe(true);
});

test('older version-1 projects import without mappings and metadata rejects duplicates or unknown versions', async () => {
  const old = { version: 1, id: 'old', name: 'Old project', characters: [], scenes: [] };
  expect(parseProjectDefinition(old)).toEqual(old);
  const { project, map } = await projectFixture();
  expect(() => parseProjectDefinition({ ...project.definition, rigMappings: [map, map] })).toThrow(
    /Duplicate rig mapping ID/,
  );
  expect(() => parseProjectDefinition({ ...project.definition, rigMappings: [{ ...map, version: 2 }] })).toThrow();
  expect(() => project.saveRigMapping({ ...map, sourceRigId: 'missing' })).toThrow(/Unknown project character/);
});
