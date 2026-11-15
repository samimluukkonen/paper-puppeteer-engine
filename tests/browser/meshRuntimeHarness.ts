import Phaser from 'phaser';
import { Actor } from '../../src/engine/Actor.js';
import { createRectangleMeshAttachment } from '../../src/engine/meshAttachments.js';
import { Puppet } from '../../src/engine/Puppet.js';
import { createEmptyScene } from '../../src/engine/SceneDefinition.js';
import { SceneRunner } from '../../src/engine/SceneRunner.js';
import type { RigDefinition } from '../../src/engine/types.js';
import { productionMesh } from '../helpers/productionMesh.js';

/** Local-only native WebGL consumer: verify triangle UVs, alpha, deformation and teardown. */
export async function sampleSkinnedMeshes() {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const scene = new Phaser.Scene('MeshConsumer');
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: host,
    width: 720,
    height: 480,
    backgroundColor: '#000000',
    render: { antialias: false, preserveDrawingBuffer: true },
    audio: { noAudio: true },
    scene: [scene],
  });
  let puppet: Puppet | undefined;
  const paint = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  try {
    const start = performance.now();
    while (!scene.sys.isActive()) {
      if (performance.now() - start > 15000) throw new Error('Mesh consumer did not boot.');
      await paint();
    }
    const art = scene.textures.createCanvas('cloth', 80, 40)!;
    const drawing = art.getContext();
    for (const [x, y, color] of [
      [0, 0, '#ff0000'],
      [40, 0, '#00ff00'],
      [0, 20, '#0000ff'],
      [40, 20, '#ffff00'],
    ] as const) {
      drawing.fillStyle = color;
      drawing.fillRect(x, y, 40, 20);
    }
    art.refresh();
    const image = new Image();
    image.src = art.canvas.toDataURL();
    await image.decode();
    scene.textures.addImage('cloth-image', image);
    const rig: RigDefinition = {
      root: 'root',
      bones: [{ id: 'root' }, { id: 'child', parent: 'root', x: 40 }],
      slots: [
        { id: 'cloth', bone: 'root' },
        { id: 'second', bone: 'root', y: 100 },
        { id: 'rigid', bone: 'root', x: 230 },
      ],
    };
    const initial = createRectangleMeshAttachment(
      { id: 'mesh', texture: 'cloth', originX: 0, originY: 0 },
      { width: 80, height: 40 },
      rig,
    );
    const weighted = {
      ...initial,
      vertices: initial.vertices.map((vertex, index) => ({
        ...vertex,
        influences:
          index === 0 || index === 3
            ? [{ boneId: 'root', weight: 1 }]
            : [
                { boneId: 'root', weight: 0.25 },
                { boneId: 'child', weight: 0.75 },
              ],
      })),
    };
    puppet = new Puppet(scene, {
      autoUpdate: false,
      x: 180,
      y: 80,
      rig: {
        ...rig,
        attachments: [weighted, { id: 'sprite', texture: 'cloth' }],
        skins: [{ version: 1, name: 'default', slots: { cloth: 'mesh', second: 'mesh', rigid: 'sprite' } }],
      },
      skin: 'default',
    });
    const mesh = puppet.getSlotMesh('cloth')!;
    const vertices = mesh.vertices;
    const indices = mesh.indices;
    const textureCount = Object.keys(scene.textures.list).length;
    const surface = document.createElement('canvas');
    surface.width = 720;
    surface.height = 480;
    const pixels = surface.getContext('2d')!;
    const capture = async () => {
      await paint();
      pixels.drawImage(game.canvas, 0, 0);
      const matrix = mesh.getWorldTransformMatrix();
      const world = Array.from({ length: 4 }, (_, i) =>
        matrix.transformPoint(mesh.vertices[i * 4]!, mesh.vertices[i * 4 + 1]!),
      );
      const colors = [
        [0.15, 0.1],
        [0.85, 0.1],
        [0.15, 0.9],
        [0.85, 0.9],
      ].map(([u = 0, v = 0]) => {
        const corners = u >= v ? [0, 1, 2] : [0, 2, 3];
        const weights = u >= v ? [1 - u, u - v, v] : [1 - v, u, v - u];
        const x = corners.reduce((sum, index, i) => sum + world[index]!.x * weights[i]!, 0);
        const y = corners.reduce((sum, index, i) => sum + world[index]!.y * weights[i]!, 0);
        return [...pixels.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
      });
      return { colors, geometry: [...mesh.vertices], image: game.canvas.toDataURL() };
    };
    const bind = await capture();
    puppet.setArtworkTexture('cloth', 'cloth-image');
    const loadedImage = await capture();
    puppet.setArtworkTexture('cloth');
    puppet.getBone('child').pose.rotation = 0.6;
    puppet.getBone('child').pose.y = 12;
    puppet.posePipeline.syncPose();
    const posed = await capture();
    puppet.setFacing('left');
    puppet.container.setPosition(420, 80).setScale(-1.3, 0.9);
    const reflected = await capture();
    puppet.getBone('root').container.setAlpha(0.5);
    mesh.setAlpha(0.5);
    puppet.posePipeline.syncPose();
    const faded = await capture();
    const stableBuffers = vertices === mesh.vertices && indices === mesh.indices;
    const texturesStable = textureCount === Object.keys(scene.textures.list).length;
    const second = puppet.getSlotMesh('second')!;
    const rigid = puppet.getSlotImage('rigid')!;
    // Draw a small rigid image over a known mesh sample and verify slot depth ordering.
    puppet.getBone('root').container.setAlpha(1);
    mesh.setAlpha(1);
    puppet.posePipeline.syncPose();
    const samplePoint = mesh
      .getWorldTransformMatrix()
      .transformPoint(
        mesh.vertices[0]! * 0.85 + mesh.vertices[4]! * 0.05 + mesh.vertices[8]! * 0.1,
        mesh.vertices[1]! * 0.85 + mesh.vertices[5]! * 0.05 + mesh.vertices[9]! * 0.1,
      );
    const puppetPoint = puppet.container.getWorldTransformMatrix().applyInverse(samplePoint.x, samplePoint.y);
    puppet.setSlotTransform('rigid', { x: puppetPoint.x, y: puppetPoint.y });
    rigid.setScale(0.15).setTint(0xffffff);
    // Its center samples yellow; whole mesh has a red sample beneath it.
    rigid.setOrigin(0.8, 0.8);
    puppet.setSlotDepth('rigid', -10);
    const behind = await capture();
    puppet.setSlotDepth('rigid', 100);
    const inFront = await capture();
    puppet.destroy();
    puppet.destroy();
    return {
      bind,
      loadedImage,
      posed,
      reflected,
      faded,
      behind,
      inFront,
      stableBuffers,
      texturesStable,
      destroyed: mesh.isDestroyed && second.isDestroyed && rigid.isDestroyed,
      textureRetained: scene.textures.exists('cloth'),
      remainingObjects: scene.children.list.length,
    };
  } finally {
    puppet?.destroy();
    game.destroy(true);
    await paint();
    host.remove();
  }
}

/** Optional local profile. Render timings cover Phaser CPU submission, not GPU completion. */
export async function profileSkinnedMeshes() {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const scene = new Phaser.Scene('MeshProfile');
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: host,
    width: 720,
    height: 480,
    audio: { noAudio: true },
    scene: [scene],
  });
  const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const rows = [];
  let actors: Puppet[] = [];
  try {
    const start = performance.now();
    while (!scene.sys.isActive()) {
      if (performance.now() - start > 15000) throw new Error('Mesh profile did not boot.');
      await paint();
    }
    scene.textures.createCanvas('paper', 80, 40)!.refresh();
    const textureCount = Object.keys(scene.textures.list).length;
    for (const side of [2, 12, 32])
      for (const count of [1, 8]) {
        const { rig, mesh } = productionMesh(side);
        actors = Array.from({ length: count }, (_, index) =>
          new Puppet(scene, {
            rig,
            skin: 'default',
            autoUpdate: false,
            x: 40 + (index % 4) * 150,
            y: 40 + Math.floor(index / 4) * 160,
            animations: [
              {
                name: 'attack',
                duration: 1000,
                loop: true,
                tracks: {
                  lower: [
                    { time: 0, rotation: 0 },
                    { time: 1000, rotation: 1 },
                  ],
                },
              },
            ],
          }).play('attack'),
        );
        const buffers = actors.map((actor) => actor.getSlotMesh('cloth')!.vertices);
        const samples: number[] = [];
        let renderStart = 0;
        const before = () => {
          renderStart = performance.now();
        };
        const after = () => {
          samples.push(performance.now() - renderStart);
        };
        game.events.on(Phaser.Core.Events.PRE_RENDER, before);
        game.events.on(Phaser.Core.Events.POST_RENDER, after);
        const seekSamples: number[] = [];
        const playbackSamples: number[] = [];
        try {
          for (let frame = 0; frame < 40; frame++) {
            const seekStart = performance.now();
            for (const actor of actors) actor.sampleAnimation((frame * 37) % 1000);
            seekSamples.push(performance.now() - seekStart);
            const updateStart = performance.now();
            for (const actor of actors) actor.update(16);
            playbackSamples.push(performance.now() - updateStart);
            await paint();
          }
        } finally {
          game.events.off(Phaser.Core.Events.PRE_RENDER, before);
          game.events.off(Phaser.Core.Events.POST_RENDER, after);
        }
        const median = (values: number[]) =>
          values.slice(5).sort((a, b) => a - b)[Math.floor((values.length - 5) / 2)] ?? 0;
        const stableBuffers = actors.every((actor, index) => actor.getSlotMesh('cloth')!.vertices === buffers[index]);
        for (const actor of actors) actor.destroy();
        actors = [];
        const sceneTimings: number[] = [];
        const runner = new SceneRunner(
          {
            ...createEmptyScene({ id: 'mesh-profile', duration: 10000 }),
            actors: Array.from({ length: count }, (_, index) => ({
              id: `actor-${index}`,
              character: { manifest: 'character.json' },
              position: { x: 0, y: 0 },
            })),
            actions: Array.from({ length: count }, (_, index) => ({
              id: `attack-${index}`,
              actorId: `actor-${index}`,
              type: 'animation',
              time: 0,
              duration: 10000,
              animation: 'attack',
              speed: 1,
              loop: true,
            })),
          },
          {
            createActor: (definition) =>
              new Actor({
                id: definition.id,
                puppetOwnership: 'owned',
                puppet: new Puppet(scene, {
                  rig,
                  skin: 'default',
                  autoUpdate: false,
                  animations: [
                    {
                      name: 'attack',
                      duration: 1000,
                      loop: true,
                      tracks: {
                        lower: [
                          { time: 0, rotation: 0 },
                          { time: 1000, rotation: 1 },
                        ],
                      },
                    },
                  ],
                }),
              }),
          },
        );
        try {
          runner.play();
          for (let frame = 0; frame < 40; frame++) {
            const start = performance.now();
            runner.update(16);
            sceneTimings.push(performance.now() - start);
          }
        } finally {
          runner.dispose();
        }
        rows.push({
          vertices: mesh.vertices.length,
          triangles: mesh.triangles.length / 3,
          actors: count,
          scenePlaybackMs: median(sceneTimings),
          renderSubmissionMs: median(samples),
          seekIKSkinningMs: median(seekSamples),
          playbackIKSkinningMs: median(playbackSamples),
          xyuvBytes: mesh.vertices.length * 4 * 8 * count,
          stableBuffers,
          resourcesClean: scene.children.list.length === 0 && Object.keys(scene.textures.list).length === textureCount,
        });
      }
    return rows;
  } finally {
    for (const actor of actors) actor.destroy();
    game.destroy(true);
    await paint();
    host.remove();
  }
}
