import { readFileSync } from 'node:fs';
import { ProjectWorkspace } from '../../src/devtools/project/ProjectWorkspace.js';
import { buildCharacterPackage } from '../../src/devtools/shared/package/characterPackage.js';
import type { AnimationClip } from '../../src/engine/AnimationClip.js';
import { CharacterDefinition } from '../../src/engine/CharacterDefinition.js';
import { inspectImageHeader } from '../../src/engine/imageHeader.js';
import { createRectangleMeshAttachment } from '../../src/engine/meshAttachments.js';
import { createRigBoneMapping } from '../../src/engine/rigBoneMapping.js';

export async function retargetFixture() {
  const project = new ProjectWorkspace('Samurai comparison', 'retarget-film');
  const png = new Uint8Array(
    readFileSync(new URL('../../public/characters/demo-puppet/images/paper-head.png', import.meta.url)),
  );
  const sourceClip: AnimationClip = {
    name: 'sword-cut',
    duration: 1000,
    loop: true,
    library: { displayName: 'Sword cut forward', tags: ['sword'] },
    tracks: {
      lower: [
        { time: 0, rotation: 0, x: 20 },
        { time: 1000, rotation: 0.8, x: 24 },
      ],
    },
    ikTracks: {
      arm: [
        { time: 0, x: 25, y: 15, mix: 1 },
        { time: 1000, x: 30, y: 20, mix: 0.5 },
      ],
    },
    rootMotion: {
      translationKeys: [
        { time: 0, x: 5, y: 0 },
        { time: 1000, x: 85, y: 10 },
      ],
    },
    deformationTracks: {
      sleeve: [
        { time: 0, offsets: {} },
        { time: 1000, offsets: { 'top-left': { x: 4, y: 2 } } },
      ],
    },
    events: [{ time: 500, name: 'cut', data: { bone: 'tip' } }],
  };
  for (const [id, factor] of [
    ['source', 1],
    ['target', 2],
  ] as const) {
    const rig = {
      root: 'root',
      bones: [
        { id: 'root', sprite: { texture: 'paper', scaleX: 0.2, scaleY: 0.2 } },
        { id: 'upper', parent: 'root', y: -20 * factor, rotation: id === 'target' ? 0.3 : 0 },
        { id: 'lower', parent: 'upper', x: 20 * factor },
        { id: 'tip', parent: 'lower', x: 20 * factor },
      ],
      ik: [
        {
          name: id === 'source' ? 'arm' : 'target-arm',
          rootBone: 'upper',
          middleBone: 'lower',
          endBone: 'tip',
          target: { x: 25 * factor, y: 15 * factor },
          mix: 1,
        },
      ],
      slots: [{ id: 'sleeve-slot', bone: 'upper' }],
      footContactMarkers: [{ id: 'contact', name: 'Foot reference', boneId: 'tip', localX: 0, localY: 0 }],
    };
    const mesh = createRectangleMeshAttachment(
      { id: 'sleeve', texture: 'paper' },
      inspectImageHeader(png)!,
      rig,
      'upper',
    );
    const definition = CharacterDefinition.fromData({
      manifest: {
        version: 1,
        id,
        rig: 'rig.json',
        defaultSkin: 'base',
        skins: { base: 'skin.json' },
        textures: { paper: 'paper.png' },
        animations: id === 'source' ? ['cut.json'] : [],
      },
      rig: { version: 1, ...rig, attachments: [mesh] },
      skins: { 'skin.json': { version: 1, name: 'base', slots: { 'sleeve-slot': 'sleeve' } } },
      animations: id === 'source' ? { 'cut.json': { version: 1, ...sourceClip } } : {},
    });
    await project.addCharacter(
      await buildCharacterPackage(
        {
          definition,
          rig: definition.rigFile!,
          skins: definition.standaloneSkins,
          animations: definition.animations,
          replacements: [],
        },
        () => Promise.resolve(new Response(png)),
      ),
      id === 'source' ? 'Samurai A' : 'Samurai B',
    );
  }
  const map = createRigBoneMapping(
    project.rigSource('source'),
    project.rigSource('target'),
    project.rigSource('source').rig.bones.map(({ id }) => ({ sourceBoneId: id, targetBoneId: id })),
    'samurai-map',
    'Samurai A → Samurai B',
  );
  project.saveRigMapping(map);
  return { project, map, sourceClip };
}
