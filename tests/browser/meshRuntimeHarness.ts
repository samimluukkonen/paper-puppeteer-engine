import Phaser from 'phaser';
import { createRectangleMeshAttachment } from '../../src/engine/meshAttachments.js';
import { Puppet } from '../../src/engine/Puppet.js';
import type { RigDefinition } from '../../src/engine/types.js';

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
    puppet.syncPose();
    const posed = await capture();
    puppet.setFacing('left');
    puppet.container.setPosition(420, 80).setScale(-1.3, 0.9);
    const reflected = await capture();
    puppet.getBone('root').container.setAlpha(0.5);
    mesh.setAlpha(0.5);
    puppet.syncPose();
    const faded = await capture();
    const stableBuffers = vertices === mesh.vertices && indices === mesh.indices;
    const texturesStable = textureCount === Object.keys(scene.textures.list).length;
    const second = puppet.getSlotMesh('second')!;
    const rigid = puppet.getSlotImage('rigid')!;
    // Draw a small rigid image over a known mesh sample and verify slot depth ordering.
    puppet.getBone('root').container.setAlpha(1);
    mesh.setAlpha(1);
    puppet.syncPose();
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
