import { expect, test, vi } from 'vitest';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { filterAnimationLibrary, independentAnimationName } from '../src/devtools/shared/animationLibraryData.js';
import { captureChoreography, insertChoreography } from '../src/devtools/shared/sceneReuse.js';
import { Actor } from '../src/engine/Actor.js';
import { retargetAnimation } from '../src/engine/animationRetargeting.js';
import { createMeshBindPose } from '../src/engine/meshBindPose.js';
import { Puppet } from '../src/engine/Puppet.js';
import { createRigBoneMapping } from '../src/engine/rigBoneMapping.js';
import { createEmptyScene, type SceneDefinition } from '../src/engine/SceneDefinition.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { productionMesh } from './helpers/productionMesh.js';
import { puppetScene } from './helpers/puppetScene.js';
import { retargetFixture } from './helpers/retargetFixture.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

// Local diagnostic, no timing thresholds. Run separately from ordinary/browser suites.
test.skipIf(import.meta.env.VITE_PROFILE !== '1')(
  'reusable asset production workloads',
  { timeout: 60000 },
  async () => {
    const { project, sourceClip } = await retargetFixture();
    const observations: Record<string, number> = {};
    const measure = (name: string, work: () => void) => {
      const start = performance.now();
      work();
      observations[name] = performance.now() - start;
    };
    const rows = Array.from({ length: 10000 }, (_, index) => ({
      character: `character-${index % 4}`,
      characterName: 'Samurai',
      rigIdentity: `rig-${index % 4}`,
      clip: { ...sourceClip, name: index ? `cut-variation-${index + 1}` : 'cut-variation' },
    }));
    measure('filter 10000 derived rows 20 times', () => {
      for (let i = 0; i < 20; i++) expect(filterAnimationLibrary(rows, 'sword', 'rig-1', true)).toHaveLength(2500);
    });
    measure('name copy among 10000 collisions', () => {
      expect(
        independentAnimationName(
          'cut',
          rows.map(({ clip }) => clip.name),
        ),
      ).toBe('cut-variation-10001');
    });
    const source = project.rigSource('source');
    const denseClip = {
      ...sourceClip,
      tracks: {
        lower: Array.from({ length: 2001 }, (_, index) => ({
          time: index / 2,
          rotation: Math.sin(index / 200),
          x: 20 + index / 1000,
        })),
      },
    };
    measure('retarget 2001 keys to four rig proportions', () => {
      for (const factor of [0.5, 1, 1.5, 2]) {
        const target = {
          id: 'target',
          rig: {
            ...source.rig,
            bones: source.rig.bones.map((bone) => ({
              ...bone,
              ...(bone.x === undefined ? {} : { x: bone.x * factor }),
            })),
          },
        };
        target.rig.attachments = (target.rig.attachments ?? []).map((attachment) =>
          attachment.type === 'mesh'
            ? { ...attachment, bindPose: createMeshBindPose(target.rig, attachment) }
            : attachment,
        );
        const result = retargetAnimation({
          sourceRig: source,
          targetRig: target,
          sourceAnimation: denseClip,
          boneMapping: createRigBoneMapping(
            source,
            target,
            source.rig.bones.map(({ id }) => ({ sourceBoneId: id, targetBoneId: id })),
            'map',
            'Map',
          ),
          options: { name: 'dense-cut', rootMotion: 'scale-by-character' },
        });
        expect(result.animation).not.toBeNull();
      }
    });
    const state = project.characterDocuments('source').animation;
    expect(state.createDerivedAnimation({ ...denseClip, name: 'dense-cut' })).toBe(true);
    measure('switch two animation documents 100 times', () => {
      for (let i = 0; i < 100; i++)
        expect(state.selectAnimation(i % 2 ? 'dense-cut' : 'sword-cut', { keepChanges: true })).toBe(true);
    });
    const mesh = productionMesh(12).rig;
    const runtimeClip = {
      name: 'cut',
      duration: 1000,
      loop: false,
      tracks: { lower: denseClip.tracks.lower.map(({ time, rotation }) => ({ time, rotation })) },
    };
    const scene = {
      ...createEmptyScene({ id: 'profile', duration: 20000 }),
      actors: Array.from({ length: 8 }, (_, index) => ({
        id: `actor-${index}`,
        character: { manifest: 'samurai/character.json' },
        position: { x: index * 100, y: 0 },
      })),
      actions: Array.from({ length: 8 }, (_, index) => ({
        id: `cut-${index}`,
        type: 'animation' as const,
        actorId: `actor-${index}`,
        time: 0,
        duration: 1000,
        animation: 'cut',
        loop: false,
        speed: 1,
      })),
    };
    const runner = new SceneRunner(scene, {
      createActor: (actor) =>
        new Actor({
          id: actor.id,
          puppetOwnership: 'owned',
          puppet: new Puppet(puppetScene(), {
            rig: mesh,
            skin: 'default',
            animations: [runtimeClip],
            autoUpdate: false,
          }),
        }),
    });
    try {
      measure('eight 144-vertex mesh Actors, 20 seeks', () => {
        for (let i = 0; i < 20; i++) runner.seek((i % 10) * 100);
      });
    } finally {
      runner.dispose();
    }
    const rigIdentity = () => 'samurai';
    const preset = captureChoreography(scene, {
      id: 'eight-cuts',
      name: 'Eight cuts',
      actionIds: scene.actions.map(({ id }) => id),
      rigIdentity,
    });
    let destination: SceneDefinition = { ...scene, id: 'destination', actions: [] };
    measure('insert ten eight-Actor choreographies', () => {
      for (let i = 0; i < 10; i++)
        destination = insertChoreography(destination, preset, {
          time: i * 1100,
          rigIdentity,
          actors: Object.fromEntries(preset.roles.map((role, index) => [role.id, `actor-${index}`])),
          validation: {
            characters: new Map([['samurai/character.json', { animations: ['cut'], skins: ['default'] }]]),
          },
        });
      expect(destination.actions).toHaveLength(80);
    });
    const start = performance.now();
    const files = (await buildProjectPackage(project)).files;
    const restored = await importProjectPackage(files);
    observations['project export and import, two mesh rigs and 2001-key clip'] = performance.now() - start;
    expect(restored.captureCharacter('source').animations).toHaveLength(2);
    console.info(JSON.stringify({ milliseconds: observations }));
  },
);
