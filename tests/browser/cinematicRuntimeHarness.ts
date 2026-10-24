import Phaser from 'phaser';
import { SceneLoader } from '../../src/engine/SceneLoader.js';

/** Browser-only consumer: no editor modules or access to the authoring stage. */
export async function sampleCinematicPackage(bytes: number[], times: number[]) {
  const host = document.createElement('div');
  host.style.cssText = 'width:1000px;height:700px;background:#0d1117';
  document.body.replaceChildren(host);
  const scene = new Phaser.Scene('CinematicConsumer');
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 1000,
    height: 700,
    transparent: true,
    render: { antialias: true, maxTextures: 1 },
    audio: { noAudio: true },
    scene: [scene],
  });
  let loaded: Awaited<ReturnType<typeof SceneLoader.loadPackage>> | undefined;
  try {
    const start = performance.now();
    while (!scene.sys.isActive()) {
      if (performance.now() - start > 15000) throw new Error('Consumer stage did not boot.');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const baseline = Object.keys(scene.textures.list).length;
    const cues: string[] = [];
    loaded = await SceneLoader.loadPackage(scene, new Uint8Array(bytes), { onCue: (cue) => cues.push(cue.name) });
    loaded.applyCamera(scene.cameras.main);
    const textures = Object.keys(scene.textures.list).length;
    const sample = () => ({
      camera: loaded!.runner.cinematicCamera,
      transition: loaded!.runner.transition,
      actors: [...loaded!.runner.actors.values()].map((actor) => ({
        id: actor.id,
        position: actor.position,
        pose: actor.puppet.rig.bones.map((bone) => ({ id: bone.id, ...actor.puppet.getBone(bone.id).pose })),
        depth: actor.puppet.container.depth,
      })),
      images: scene.children.list
        .filter((object) => object instanceof Phaser.GameObjects.Image)
        .map((object) => {
          const image = object;
          return { x: image.x, y: image.y, depth: image.depth, visible: image.visible };
        }),
    });
    const samples = [];
    for (const time of times) {
      loaded.runner.seek(time);
      samples.push(sample());
    }
    if (textures !== Object.keys(scene.textures.list).length) throw new Error('Seeking allocated new textures.');
    const passiveCues = [...cues];
    loaded.runner.restart();
    loaded.runner.update(1000);
    const played = sample();
    const playbackCues = [...cues];
    loaded.dispose();
    loaded.dispose();
    return {
      samples,
      played,
      passiveCues,
      playbackCues,
      textures,
      texturesAfterDispose: Object.keys(scene.textures.list).length,
      baseline,
      remainingObjects: scene.children.list.length,
    };
  } finally {
    loaded?.dispose();
    game.destroy(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    host.remove();
  }
}
