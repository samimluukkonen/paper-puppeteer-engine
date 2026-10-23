import { performance } from 'node:perf_hooks';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { AnimationEditorDocument } from '../src/devtools/animation-editor/AnimationEditorDocument.js';
import {
  assetDependents,
  ProjectInspector,
  ProjectValidationError,
  requireValidExport,
  type ProjectInspectionInput,
} from '../src/devtools/project/projectInspection.js';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  importProjectPackage,
} from '../src/devtools/project/projectPackage.js';
import { ProjectValidationPanel } from '../src/devtools/project/ProjectValidationPanel.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import { buildCharacterPackage, type PackageSnapshot } from '../src/devtools/shared/package/characterPackage.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import type { SceneDefinition } from '../src/engine/SceneDefinition.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

function fixture(id = 'hero') {
  const rig = {
    version: 1 as const,
    root: 'root',
    bones: [
      { id: 'root', sprite: { texture: 'paper' } },
      { id: 'arm', parent: 'root', x: 10 },
      { id: 'hand', parent: 'arm', x: 10 },
    ],
    ik: [{ name: 'reach', rootBone: 'root', middleBone: 'arm', endBone: 'hand' }],
    slots: [{ id: 'hand-slot', bone: 'hand' }],
    attachments: [{ id: 'hand-image', texture: 'paper' }],
    skins: [{ version: 1 as const, name: 'alternate', slots: { 'hand-slot': 'hand-image' } }],
  };
  const clip = {
    name: 'wave',
    duration: 1000,
    loop: true,
    tracks: { root: [{ time: 0, x: 2 }] },
    ikTracks: { reach: [{ time: 0, x: 10 }] },
  };
  const definition = CharacterDefinition.fromData(
    {
      manifest: {
        version: 1,
        id,
        rig: 'rig.json',
        skins: { default: 'skins/default.json' },
        defaultSkin: 'default',
        animations: ['wave.json'],
        textures: { paper: 'images/paper.png' },
      },
      rig,
      skins: { 'skins/default.json': { version: 1, name: 'default', slots: { 'hand-slot': 'hand-image' } } },
      animations: { 'wave.json': { ...clip, version: 1 } },
    },
    'https://character-package.invalid/character.json',
  );
  const snapshot: PackageSnapshot = {
    definition,
    rig,
    skins: definition.standaloneSkins,
    animations: [clip],
    replacements: [],
  };
  const image = artworkFixture().documents['images/paper.png'];
  if (!(image instanceof Uint8Array)) throw new Error('Missing fixture image');
  const files = new Map([['images/paper.png', new Uint8Array(image)]]);
  const scene: SceneDefinition = {
    ...createEmptyScene({ id: 'training', name: 'Training' }),
    actors: [
      {
        id: 'guard',
        character: { manifest: `characters/${id}/character.json` },
        position: { x: 0, y: 0 },
        animation: 'wave',
        skin: 'alternate',
      },
    ],
    actions: [0, 1, 2].map((index) => ({
      id: `clip-${index}`,
      actorId: 'guard',
      type: 'animation',
      time: index * 1000,
      duration: 1000,
      animation: 'wave',
      loop: true,
      speed: 1,
    })),
  };
  const project = {
    version: 1,
    id: 'film',
    name: 'Film',
    characters: [{ id, name: 'Hero', manifest: `characters/${id}/character.json` }],
    scenes: [{ id: scene.id, path: 'scenes/training.json' }],
  };
  const input: { -readonly [K in keyof ProjectInspectionInput]: ProjectInspectionInput[K] } = {
    definition: project,
    characters: new Map([[id, { snapshot, files }]]),
    scenes: new Map([[scene.id, scene]]),
  };
  return { input, project, snapshot, rig, files, scene, definition, clip };
}
const inspect = (input: ProjectInspectionInput) => new ProjectInspector().inspect(input, 'export');

test.each(['animations/inspection-0.json', '__inspection/rig.json'])(
  'inspection metadata avoids collisions with the valid source rig path %s',
  (rigPath) => {
    const f = fixture();
    const definition = CharacterDefinition.fromData({
      manifest: { ...f.definition.manifest, rig: rigPath },
      rig: f.rig,
      skins: { 'skins/default.json': f.snapshot.skins[0] },
      animations: { 'wave.json': { ...f.clip, version: 1 } },
    });
    const input = {
      ...f.input,
      characters: new Map([['hero', { snapshot: { ...f.snapshot, definition }, files: f.files }]]),
    };
    expect(inspect(input).issues).toEqual([]);
    const broken = {
      ...input,
      characters: new Map([
        [
          'hero',
          {
            snapshot: { ...f.snapshot, definition, animations: [{ ...f.clip, tracks: { missing: [{ time: 0 }] } }] },
            files: f.files,
          },
        ],
      ]),
    };
    const issue = inspect(broken).issues[0]!;
    expect(issue).toMatchObject({ view: 'animation', asset: { kind: 'animation', owner: 'hero', id: 'wave' } });
    expect(issue.message).toContain('Animation "wave"');
    expect(issue.message).not.toContain('__inspection');
  },
);

test('complete projects produce no fabricated notices, expose scoped dependency relationships and keep sources immutable', () => {
  const f = fixture();
  const before = JSON.stringify([f.snapshot, f.scene, f.project, [...f.files]]);
  const report = inspect(f.input);
  expect(report.issues).toEqual([]);
  expect(() => requireValidExport(report)).not.toThrow();
  const kinds = new Set(report.dependencies.flatMap(({ from, to }) => [from.kind, to.kind]));
  for (const kind of [
    'project',
    'character',
    'rig',
    'bone',
    'ik',
    'slot',
    'skin',
    'attachment',
    'texture',
    'animation',
    'scene',
    'actor',
    'action',
  ])
    expect(kinds.has(kind as (typeof report.dependencies)[number]['from']['kind'])).toBe(true);
  const dependents = assetDependents(report, { kind: 'animation', owner: 'hero', id: 'wave' });
  expect(dependents.filter(({ from }) => from.kind === 'action')).toHaveLength(3);
  expect(dependents.map(({ label }) => label).join(' ')).toContain('Training');
  expect(assetDependents(report, { kind: 'animation', owner: 'another', id: 'wave' })).toEqual([]);
  expect(JSON.stringify([f.snapshot, f.scene, f.project, [...f.files]])).toBe(before);
});

test('missing images are draft warnings, block production exports and can be resolved by a committed shared replacement', () => {
  const f = fixture();
  f.files.delete('images/paper.png');
  f.files.set('rig.json', new TextEncoder().encode('{}'));
  const inspector = new ProjectInspector();
  const draft = inspector.inspect(f.input);
  expect(draft.counts).toEqual({ error: 0, warning: 1, information: 0 });
  expect(() => requireValidExport(draft)).toThrow(/production export validation/);
  const production = inspector.inspect(f.input, 'export');
  expect(production.issues[0]).toMatchObject({ severity: 'error', view: 'rig', asset: { owner: 'hero' } });
  expect(production.issues[0]!.message).toContain('images/paper.png');
  expect(() => requireValidExport(production)).toThrow(ProjectValidationError);
  const input = {
    ...f.input,
    characters: new Map([
      [
        'hero',
        {
          files: f.files,
          snapshot: {
            ...f.snapshot,
            replacements: [
              {
                assetKey: 'paper',
                reference: undefined,
                blob: new Blob(['image']),
                format: 'image/png' as const,
                originScaleX: 1,
                originScaleY: 1,
              },
            ],
          },
        },
      ],
    ]),
  };
  expect(inspect(input).issues).toEqual([]);
});

test.each([
  [
    'bone',
    (f: ReturnType<typeof fixture>) => {
      f.rig.bones[1]!.parent = 'missing';
    },
    /unknown parent/,
  ],
  [
    'IK bone',
    (f: ReturnType<typeof fixture>) => {
      f.rig.ik[0]!.middleBone = 'missing';
    },
    /Unknown IK bone/,
  ],
  [
    'animation bone',
    (f: ReturnType<typeof fixture>) => {
      f.input.characters = new Map([
        [
          'hero',
          {
            snapshot: { ...f.snapshot, animations: [{ ...f.clip, tracks: { missing: [{ time: 0 }] } }] },
            files: f.files,
          },
        ],
      ]);
    },
    /unknown bone/,
  ],
  [
    'animation IK',
    (f: ReturnType<typeof fixture>) => {
      f.input.characters = new Map([
        [
          'hero',
          {
            snapshot: {
              ...f.snapshot,
              animations: [{ ...f.snapshot.animations[0]!, ikTracks: { missing: [{ time: 0, x: 1 }] } }],
            },
            files: f.files,
          },
        ],
      ]);
    },
    /Unknown IK constraint/,
  ],
  [
    'skin attachment',
    (f: ReturnType<typeof fixture>) => {
      f.rig.skins[0]!.slots['hand-slot'] = 'missing';
    },
    /Unknown attachment/,
  ],
  [
    'duplicate bone',
    (f: ReturnType<typeof fixture>) => {
      f.rig.bones.push({ ...f.rig.bones[0]! });
    },
    /Duplicate bone/,
  ],
  [
    'missing character',
    (f: ReturnType<typeof fixture>) => {
      f.scene.actors[0]!.character.manifest = 'missing.json';
    },
    /Unknown character/,
  ],
  [
    'missing animation',
    (f: ReturnType<typeof fixture>) => {
      f.scene.actions[0] = {
        ...f.scene.actions[0]!,
        type: 'animation',
        animation: 'missing',
        duration: 1000,
        loop: true,
        speed: 1,
      };
    },
    /Unknown animation/,
  ],
  [
    'missing actor',
    (f: ReturnType<typeof fixture>) => {
      f.scene.actions[0]!.actorId = 'missing';
    },
    /Unknown actor/,
  ],
  [
    'look target',
    (f: ReturnType<typeof fixture>) => {
      f.scene.actions.push({
        id: 'look',
        type: 'face',
        actorId: 'guard',
        time: 0,
        target: { type: 'actor', actorId: 'missing' },
      });
    },
    /Unknown target actor/,
  ],
  [
    'duplicate character ID',
    (f: ReturnType<typeof fixture>) => {
      f.project.characters.push({ ...f.project.characters[0]!, id: 'HERO' });
    },
    /Duplicate project asset ID/,
  ],
  [
    'duplicate animation',
    (f: ReturnType<typeof fixture>) => {
      f.input.characters = new Map([
        [
          'hero',
          {
            snapshot: { ...f.snapshot, animations: [f.snapshot.animations[0]!, f.snapshot.animations[0]!] },
            files: f.files,
          },
        ],
      ]);
    },
    /Duplicate animation/,
  ],
  [
    'duplicate skin',
    (f: ReturnType<typeof fixture>) => {
      f.input.characters = new Map([
        ['hero', { snapshot: { ...f.snapshot, skins: [f.snapshot.skins[0]!, f.snapshot.skins[0]!] }, files: f.files }],
      ]);
    },
    /Duplicate standalone skin/,
  ],
  [
    'unsafe package path',
    (f: ReturnType<typeof fixture>) => {
      f.files.set('../private.png', new Uint8Array([1]));
    },
    /Invalid package path/,
  ],
  [
    'unsupported scene version',
    (f: ReturnType<typeof fixture>) => {
      f.input.scenes = new Map([['training', { ...f.scene, version: 99 }]]);
    },
    /Unsupported scene format version/,
  ],
  [
    'unsupported rig version',
    (f: ReturnType<typeof fixture>) => {
      f.input.characters = new Map([
        [
          'hero',
          { snapshot: { ...f.snapshot, rig: { ...f.rig, version: 99 } } as unknown as PackageSnapshot, files: f.files },
        ],
      ]);
    },
    /Unsupported rig format version/,
  ],
] as const)('reports %s using existing validators', (_label, change, expected) => {
  const f = fixture();
  change(f);
  const report = inspect(f.input);
  expect(report.issues.map(({ message }) => message).join('\n')).toMatch(expected);
  expect(report.counts.error).toBeGreaterThan(0);
});

test('static image frame references remain editable and must be resolved before production export', () => {
  const f = fixture();
  const rig = { ...f.rig, attachments: [{ id: 'hand-image', texture: 'paper', frame: 'hand' }] };
  const input = { ...f.input, characters: new Map([['hero', { snapshot: { ...f.snapshot, rig }, files: f.files }]]) };
  const inspector = new ProjectInspector();
  expect(inspector.inspect(input).counts).toEqual({ error: 0, warning: 1, information: 0 });
  const report = inspector.inspect(input, 'export');
  expect(report.issues[0]!.message).toContain('hand-image');
  expect(report.counts.error).toBe(1);
});

test('large projects cache checks per authored asset; a track edit checks only its character', () => {
  const fixtures = Array.from({ length: 120 }, (_, index) => fixture(`hero-${index}`));
  const input: ProjectInspectionInput = {
    definition: {
      ...fixtures[0]!.project,
      characters: fixtures.flatMap((f) => f.project.characters),
      scenes: fixtures.map((_, index) => ({ id: `scene-${index}`, path: `scenes/${index}.json` })),
    },
    characters: new Map(fixtures.flatMap((f) => [...f.input.characters])),
    scenes: new Map(fixtures.map((f, index) => [`scene-${index}`, { ...f.scene, id: `scene-${index}` }])),
  };
  const inspector = new ProjectInspector();
  const started = performance.now();
  const full = inspector.inspect(input);
  expect(full.counts.error).toBe(0);
  expect(full.checked).toEqual({ characters: 120, scenes: 120 });
  expect(inspector.inspect(input).checked).toEqual({ characters: 0, scenes: 0 });
  fixtures[70]!.clip.tracks.root[0]!.x = 45;
  const edited = inspector.inspect(input);
  expect(edited.checked).toEqual({ characters: 1, scenes: 0 });
  expect(edited.issues).toEqual([]);
  expect(inspector.inspect(input, 'draft', true).checked).toEqual({ characters: 120, scenes: 120 });
  const changed = new Map(input.characters);
  const character = changed.get('hero-70')!;
  changed.set('hero-70', { ...character, snapshot: { ...character.snapshot!, animations: [] } });
  const renamed = inspector.inspect({ ...input, characters: changed });
  expect(renamed.checked).toEqual({ characters: 1, scenes: 1 });
  expect(renamed.counts.error).toBe(4);
  // Generous guard catches accidental quadratic/explosive work, not workstation speed.
  expect(performance.now() - started).toBeLessThan(10000);
});

test('production package APIs block broken working dependencies and scene exports ignore unrelated assets', async () => {
  const f = fixture();
  const project = new ProjectWorkspace('Film');
  await project.addCharacter(
    await buildCharacterPackage(f.snapshot, () => Promise.resolve(new Response(f.files.get('images/paper.png')))),
  );
  const scene = {
    ...f.scene,
    actors: f.scene.actors.map((actor) => ({ ...actor, character: { manifest: project.characterReference('hero') } })),
  };
  project.addScene(scene);
  const source = project.captureCharacter('hero');
  project.character('hero').capture = () => ({ ...source, animations: [] });
  await expect(buildProjectPackage(project)).rejects.toThrow(/Unknown animation/);
  await expect(buildProjectScenePackage(project, scene)).rejects.toThrow(/Unknown animation/);
  project.character('hero').capture = () => source;
  const draft = createNewCharacter({ id: 'other', name: 'Other' });
  await project.addCharacter(
    await buildCharacterPackage({
      definition: draft.definition,
      rig: draft.definition.rigFile!,
      skins: draft.definition.standaloneSkins,
      animations: [],
      replacements: [],
    }),
  );
  project.character('other').loading = true;
  await expect(buildProjectPackage(project)).rejects.toThrow(/still opening/);
  expect((await buildProjectScenePackage(project, scene)).has('scene.json')).toBe(true);
  const dependents = project.dependents({ kind: 'character', owner: 'hero', id: 'hero' });
  expect(dependents.some(({ label }) => label.includes('guard'))).toBe(true);
  expect(() => project.remove('characters', 'hero')).toThrow(/Training.*guard/);
  project.character('other').loading = false;
  project.character('hero').capture = () => ({
    ...source,
    replacements: [
      {
        assetKey: 'paper',
        reference: 'bone:removed',
        blob: new Blob(['invalid-image']),
        format: 'image/png',
        originScaleX: 1,
        originScaleY: 1,
      },
    ],
  });
  // Final package checks retain their own authority and surface failures in the panel report.
  try {
    await buildProjectPackage(project);
    expect.fail('An invalid replacement must not export.');
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectValidationError);
    if (!(error instanceof ProjectValidationError)) throw error;
    expect(error.report.issues.at(-1)).toMatchObject({ severity: 'error', view: 'rig', path: 'package' });
  }
});

test('pending artwork does not hide dependency warnings and referenced skins cannot be renamed', async () => {
  const f = fixture();
  const project = new ProjectWorkspace('Film');
  const files = await buildCharacterPackage(f.snapshot, () =>
    Promise.resolve(new Response(f.files.get('images/paper.png'))),
  );
  await project.addCharacter(files);
  const source = project.captureCharacter('hero');
  project.character('hero').capture = () => ({ ...source, pendingArtwork: true });
  expect(
    project
      .dependents({ kind: 'texture', owner: 'hero', id: 'paper' })
      .filter(({ from }) => from.kind === 'bone' || from.kind === 'attachment'),
  ).toHaveLength(2);
  const state = new RigEditorState(f.definition.rig, f.rig);
  state.skinReferences = () => ['Scene "Training", Actor "guard"'];
  expect(() => state.renameSkin('alternate', 'changed')).toThrow(/Training.*guard/);
  expect(state.skins.some(({ name }) => name === 'alternate')).toBe(true);
});

test.each([
  'missing image',
  'duplicate bone',
  'deleted animation',
  'broken IK',
  'missing character',
  'unsupported version',
  'unsafe path',
])('both production exporters reject %s without changing saved checkpoints', async (defect) => {
  const f = fixture();
  const project = new ProjectWorkspace('Production Film');
  await project.addCharacter(
    await buildCharacterPackage(f.snapshot, () => Promise.resolve(new Response(f.files.get('images/paper.png')))),
  );
  const scene = {
    ...f.scene,
    actors: f.scene.actors.map((actor) => ({ ...actor, character: { manifest: project.characterReference('hero') } })),
  };
  project.addScene(scene);
  const valid = await buildProjectPackage(project);
  project.markExported(valid.metadata, valid.characters, valid.scenes);
  const snapshot = project.captureCharacter('hero');
  let broken = snapshot;
  // Deliberately corrupt the fixture's backing map beyond its readonly public contract.
  const files = project.character('hero').files as Map<string, Uint8Array<ArrayBuffer>>;
  if (defect === 'missing image') files.delete('images/paper.png');
  if (defect === 'duplicate bone')
    broken = { ...snapshot, rig: { ...snapshot.rig, bones: [...snapshot.rig.bones, snapshot.rig.bones[0]!] } };
  if (defect === 'deleted animation') broken = { ...snapshot, animations: [] };
  if (defect === 'broken IK')
    broken = { ...snapshot, rig: { ...snapshot.rig, ik: [{ ...snapshot.rig.ik![0]!, middleBone: 'missing' }] } };
  if (defect === 'unsupported version')
    broken = { ...snapshot, rig: { ...snapshot.rig, version: 99 } } as unknown as PackageSnapshot;
  if (defect === 'unsafe path') files.set('../private.png', new Uint8Array([1]));
  if (defect === 'missing character') {
    expect(
      project.scenes.importJson(
        JSON.stringify({ ...scene, actors: [{ ...scene.actors[0], character: { manifest: 'missing.json' } }] }),
      ),
    ).toBe(true);
  }
  project.character('hero').capture = () => broken;
  const authored = project.scenes.workingScene;
  await expect(buildProjectPackage(project)).rejects.toBeInstanceOf(ProjectValidationError);
  await expect(buildProjectScenePackage(project, authored!)).rejects.toBeInstanceOf(ProjectValidationError);
  expect(project.dirty).toBe(false);
  expect(project.scenes.workingScene).toBe(authored);
  expect(project.history.canUndo).toBe(true);
  // The previously downloaded complete package remains independent of damaged working data.
  const intact = await importProjectPackage(valid.files);
  expect(intact.captureCharacter('hero').animations[0]!.name).toBe('wave');
  expect(intact.character('hero').files.get('images/paper.png')).toEqual(f.files.get('images/paper.png'));
});

test('final project archive budget errors surface as blocking project diagnostics', async () => {
  const project = new ProjectWorkspace('Large film', 'large-film');
  for (let index = 0; index < 256; index++) project.createScene({ id: `scene-${index}` });
  try {
    await buildProjectPackage(project);
    expect.fail('The archive includes project.json in addition to its 256 scene files.');
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectValidationError);
    if (!(error instanceof ProjectValidationError)) throw error;
    expect(error.report.issues.at(-1)).toMatchObject({
      severity: 'error',
      view: 'project',
      asset: { kind: 'project', id: 'large-film' },
    });
  }
});

test('replacement rejection preserves authored animation sessions and the existing unsaved guard', () => {
  const f = fixture();
  const document = new AnimationEditorDocument(f.definition.rig, f.snapshot.animations);
  document.selectAnimation('wave');
  const original = document.workingAnimation;
  const guard = vi.fn(() => false);
  document.replacementGuard = guard;
  const json = JSON.stringify({ ...original, duration: 2000, version: 1 });
  expect(document.importJson(json)).toBe(false);
  expect(guard).toHaveBeenCalledWith('wave');
  expect(document.workingAnimation).toBe(original);
  document.replacementGuard = () => true;
  expect(document.importJson(json)).toBe(true);
  expect(document.workingAnimation!.duration).toBe(2000);
  document.install({ ...document.workingAnimation!, duration: 3000 });
  expect(document.importJson(json, { confirmDiscard: () => false })).toBe(false);
  expect(document.workingAnimation!.duration).toBe(3000);
});

test('validation panel renders real diagnostics, artist advice, editor links and an honest healthy state', () => {
  const f = fixture();
  f.scene.actors[0]!.animation = 'missing';
  const report = inspect(f.input);
  const html = renderToStaticMarkup(
    ProjectValidationPanel({ report, busy: false, revalidate: () => {}, openAsset: () => {} }),
  );
  expect(html).toContain('Unknown animation');
  expect(html).toContain('Scene Editor');
  expect(html).toContain('Revalidate');
  expect(html).toContain('Production export');
  const healthy = renderToStaticMarkup(
    ProjectValidationPanel({
      report: inspect(fixture().input),
      busy: false,
      revalidate: () => {},
      openAsset: () => {},
    }),
  );
  expect(healthy).toContain('No problems found');
  expect(healthy).not.toContain('Open Affected Asset');
});
