import type { AnimationClip } from '../../src/engine/AnimationClip.js';
import { createEmptyScene, type SceneDefinition } from '../../src/engine/SceneDefinition.js';
import type { StoryDefinition } from '../../src/engine/StoryDefinition.js';
import { productionMesh } from './productionMesh.js';
import { assetFixture } from './scenePackageFixtures.js';

/** Synthetic acceptance content only; no application-specific story or gameplay rules. */
export function linearStoryFixture(meshSide = 12, imageSize = { width: 80, height: 40 }) {
  const assets = assetFixture();
  const { skins, ...rig } = productionMesh(meshSide).rig;
  rig.attachments = rig.attachments!.map((attachment) =>
    attachment.type === 'mesh' ? { ...attachment, imageSize } : attachment,
  );
  const animations: AnimationClip[] = ['walk', 'idle', 'sword-cut'].map((name) => ({
    name,
    duration: 1000,
    loop: name === 'idle',
    tracks: {
      lower: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 0.5 },
      ],
      ...(name === 'idle'
        ? {
            root: [
              { time: 0, scaleY: 1 },
              { time: 500, scaleY: 1.02 },
              { time: 1000, scaleY: 1 },
            ],
          }
        : {}),
    },
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0, y: 0 },
        { time: 1000, x: 200, y: 0 },
      ],
    },
    deformationTracks: {
      sleeve: [
        { time: 0, offsets: {} },
        { time: 500, offsets: { v0: { x: 3, y: -2 } } },
        { time: 1000, offsets: {} },
      ],
    },
    events: [{ time: 750, name: `${name}-event` }],
  }));
  assets.documents['character.json'] = {
    version: 1,
    id: 'hero',
    rig: 'rig.json',
    defaultSkin: 'default',
    skins: { default: 'skins/default.json' },
    animations: animations.map(({ name }) => `animations/${name}.json`),
    textures: { paper: 'images/paper.png' },
  };
  assets.documents['rig.json'] = { version: 1, ...rig };
  assets.documents['skins/default.json'] = skins![0];
  for (const animation of animations)
    assets.documents[`animations/${animation.name}.json`] = { version: 1, ...animation };
  const scenes = new Map<string, SceneDefinition>();
  for (const [index, name] of ['Forest Arrival', 'Samurai Encounter', 'Sword Demonstration'].entries()) {
    const id = ['forest', 'encounter', 'sword'][index]!;
    const scene = createEmptyScene({ id, name, duration: 1000 });
    scene.actors = (index === 1 ? ['hero', 'friend'] : ['hero']).map((id, actorIndex) => ({
      id,
      character: { manifest: 'characters/hero/character.json' },
      position: { x: actorIndex * 200 - 100, y: 0 },
      dialogueIdle: { animation: 'idle', policy: 'overlay-snap' },
    }));
    scene.images = [
      {
        id: 'forest',
        image: 'forest.png',
        position: { x: -1024, y: -512 },
        scale: { x: 1, y: 1 },
        visible: true,
        order: 0,
      },
    ];
    scene.actions = [
      {
        id: 'motion',
        actorId: 'hero',
        type: 'animation',
        time: 0,
        duration: 1000,
        animation: index === 2 ? 'sword-cut' : 'walk',
        loop: false,
        speed: 1,
        movementSource: 'rootMotion',
      },
    ];
    if (index === 1)
      scene.actions.push(
        { id: 'face-hero', type: 'face', actorId: 'hero', time: 0, target: { type: 'actor', actorId: 'friend' } },
        { id: 'face-friend', type: 'face', actorId: 'friend', time: 0, target: { type: 'actor', actorId: 'hero' } },
      );
    scene.actions.push({ id: 'cue', actorId: 'hero', type: 'cue', time: 750, name: 'after-hold' });
    scene.cameraTracks = {
      x: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 1000, value: 100 },
      ],
      zoom: [
        { id: 'start', time: 0, value: 1 },
        { id: 'end', time: 1000, value: 1.5 },
      ],
    };
    scene.dialogue =
      index === 1
        ? ['01-question', '02-reply'].map((id, i) => ({
            id,
            actorId: i ? 'friend' : 'hero',
            text: id,
            time: 0,
            duration: 0,
            progression: 'advance-required',
          }))
        : [
            { id: 'narration', time: 0, duration: 400, text: name },
            { id: 'response', actorId: 'hero', time: 500, duration: 0, text: name, progression: 'advance-required' },
          ];
    scene.audioAssets = [
      { id: 'tone', name: 'Forest / sword test sound', path: 'audio/tone.wav', category: 'ambience' },
    ];
    scene.audioTracks = [
      { id: 'ambience', name: 'Ambience', category: 'ambience' },
      { id: 'sfx', name: 'Sword', category: 'sfx' },
    ];
    scene.audioClips = [
      {
        id: 'bed',
        assetId: 'tone',
        trackId: 'ambience',
        time: 0,
        duration: 1000,
        sourceOffset: 0,
        volume: 0.3,
        loop: true,
      },
      {
        id: 'hold',
        assetId: 'tone',
        trackId: 'ambience',
        time: 0,
        duration: 1000,
        sourceOffset: 0,
        volume: 0.2,
        loop: true,
        playback: 'dialogue-hold',
      },
    ];
    if (index === 2) {
      scene.audioClips.push({
        id: 'sword',
        assetId: 'tone',
        trackId: 'sfx',
        time: 250,
        duration: 200,
        sourceOffset: 0,
        volume: 1,
        loop: false,
      });
      scene.transitions = [{ id: 'ending', type: 'fade-out', time: 750, duration: 250, color: '#000000' }];
    }
    scenes.set(id, scene);
  }
  const story: StoryDefinition = {
    version: 1,
    id: 'acceptance',
    name: 'Linear acceptance',
    scenes: [...scenes.keys()].map((sceneAssetId, index) => ({
      id: `entry-${index}`,
      sceneAssetId,
      ...(index ? { transition: { type: 'fade' as const, duration: 100, color: '#000000' } } : {}),
    })),
  };
  return { assets, rig: { ...rig, skins }, animations, scenes, story };
}
