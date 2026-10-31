import Phaser from 'phaser';
import { createEditorGame, destroyEditorGame } from '../../src/devtools/shared/editorGame.js';
import { loadSceneCharacter } from '../../src/engine/loadSceneCharacter.js';
import { Puppet } from '../../src/engine/Puppet.js';

/** Local diagnostic of actual WebGL submissions, excluding animation, UI and GPU completion time. */
export async function profileEditorTextures(singleTexture: boolean) {
  const host = document.createElement('div');
  host.id = 'texture-profile';
  host.style.cssText = 'width:760px;height:640px';
  document.body.append(host);
  const scene = new Phaser.Scene('TextureProfile');
  // Preserve the original editor configuration as the comparison baseline.
  const game = singleTexture
    ? new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.id,
        width: 760,
        height: 640,
        transparent: true,
        render: { antialias: true, maxTextures: 1 },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [scene],
      })
    : createEditorGame(host.id, scene);
  const puppets: Puppet[] = [];
  try {
    const start = performance.now();
    while (!scene.sys.isActive()) {
      if (performance.now() - start > 15000) throw new Error('Texture profile did not boot.');
      await new Promise(requestAnimationFrame);
    }
    const renderer = game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) throw new Error('Profile requires WebGL.');
    const definition = await loadSceneCharacter(scene, '/characters/demo-puppet/character.json');
    if (!definition) throw new Error('Texture profile artwork did not load.');
    game.loop.stop();
    let drawCalls = 0;
    const drawElements = renderer.drawElements.bind(renderer);
    renderer.drawElements = (...args: Parameters<typeof renderer.drawElements>) => {
      drawCalls++;
      drawElements(...args);
    };
    const render = () => {
      drawCalls = 0;
      renderer.preRender();
      game.scene.render(renderer);
      renderer.postRender();
    };
    const measurements = [];
    for (const count of [1, 5]) {
      while (puppets.length < count) {
        puppets.push(
          new Puppet(scene, {
            definition,
            autoUpdate: false,
            x: 90 + puppets.length * 140,
            y: 340,
            scale: 0.35,
            facing: puppets.length % 2 ? 'left' : 'right',
          }),
        );
      }
      for (let frame = 0; frame < 60; frame++) render();
      const samples = [];
      for (let batch = 0; batch < 5; batch++) {
        renderer.gl.finish();
        const start = performance.now();
        for (let frame = 0; frame < 120; frame++) render();
        samples.push((performance.now() - start) / 120);
      }
      // Read the actual drawing buffer before browser compositing clears it.
      render();
      const pixels = new Uint8Array(game.canvas.width * game.canvas.height * 4);
      const gl = renderer.gl;
      gl.readPixels(0, 0, game.canvas.width, game.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Texture profile encountered a WebGL error.');
      if (!pixels.some((value, i) => i % 4 === 3 && value > 0)) throw new Error('Texture profile rendered no artwork.');
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      const pixelHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
      samples.sort((a, b) => a - b);
      measurements.push({ puppets: count, drawCalls, medianRenderMs: samples[2]!, pixelHash });
    }
    return { maxTextures: renderer.maxTextures, measurements };
  } finally {
    for (const puppet of puppets) puppet.destroy();
    destroyEditorGame(game);
    host.remove();
  }
}
